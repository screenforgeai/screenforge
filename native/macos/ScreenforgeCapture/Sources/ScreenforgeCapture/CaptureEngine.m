#import "CaptureEngine.h"
#import <AudioToolbox/AudioToolbox.h>
#import <CoreMedia/CoreMedia.h>
#import <QuartzCore/QuartzCore.h>
#import <math.h>

@interface CaptureEngine () <SCStreamOutput>
@property (nonatomic) NSInteger displayIndex;
@property (nonatomic) CGDirectDisplayID displayId;
@property (nonatomic) BOOL hasDisplayId;
@property (nonatomic) CGWindowID windowId;
@property (nonatomic) BOOL hasWindowId;
@property (nonatomic, copy, nullable) NSString *excludeWindowTitle;
@property (nonatomic, copy) NSString *outputPath;
@property (nonatomic) NSInteger fps;

@property (nonatomic, strong, nullable) SCStream *stream;
@property (nonatomic, strong, nullable) AVAssetWriter *assetWriter;
@property (nonatomic, strong, nullable) AVAssetWriterInput *videoInput;
@property (nonatomic, strong, nullable) AVAssetWriterInput *audioInput;
@property (nonatomic) BOOL sessionStarted;
@property (nonatomic) NSUInteger framesWritten;
@property (nonatomic) BOOL loggedAppendFailure;
@property (nonatomic) CMTime pauseOffset;
@property (nonatomic) CMTime pauseStart;
@property (nonatomic) BOOL isPaused;
@property (nonatomic, strong) dispatch_queue_t sampleQueue;
@property (nonatomic, strong, nullable) dispatch_source_t boundsTimer;
@property (nonatomic) CGRect lastWindowBounds;
@property (nonatomic) CGFloat lastWindowScaleFactor;
// Cached pixel buffer from the last SCFrameStatusComplete frame.
// Re-used to synthesize frames for SCFrameStatusIdle intervals so that
// window recordings maintain 60 fps even when the window is static.
@property (nonatomic) CVPixelBufferRef lastCompletePixelBuffer;
// ── Diagnostics ───────────────────────────────────────────────────────────────
@property (nonatomic) NSUInteger framesComplete;    // SCFrameStatusComplete received
@property (nonatomic) NSUInteger framesIdle;        // SCFrameStatusIdle received
@property (nonatomic) NSUInteger framesSynthetic;   // synthetic frames written from idle
@property (nonatomic) NSUInteger framesDropped;     // dropped because writer not ready
@property (nonatomic) BOOL loggedFirstSynthetic;    // one-shot log for first synthetic
@property (nonatomic) CFTimeInterval sessionWallStart; // CACurrentMediaTime() at session open
@property (nonatomic) CMTime lastWrittenPTS;        // PTS of the last frame passed to writer
@end

static BOOL RectsNearlyEqual(CGRect a, CGRect b) {
    return fabs(a.origin.x - b.origin.x) < 0.5 &&
           fabs(a.origin.y - b.origin.y) < 0.5 &&
           fabs(a.size.width - b.size.width) < 0.5 &&
           fabs(a.size.height - b.size.height) < 0.5;
}

static CGFloat scaleFactorForBounds(CGRect bounds) {
    CGFloat centerX = CGRectGetMidX(bounds);
    CGFloat centerY = CGRectGetMidY(bounds);

    for (NSScreen *screen in NSScreen.screens) {
        if (NSPointInRect(NSMakePoint(centerX, centerY), screen.frame)) {
            return screen.backingScaleFactor > 0 ? screen.backingScaleFactor : 1.0;
        }
    }

    NSScreen *mainScreen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    return mainScreen.backingScaleFactor > 0 ? mainScreen.backingScaleFactor : 1.0;
}

static BOOL getWindowBounds(CGWindowID windowId, CGRect *boundsOut, CGFloat *scaleFactorOut) {
    CFArrayRef infoRef = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
    NSArray<NSDictionary *> *info = CFBridgingRelease(infoRef);
    NSDictionary *entry = info.firstObject;
    if (!entry) {
        return NO;
    }

    NSDictionary *boundsDict = entry[(id)kCGWindowBounds];
    CGRect bounds = CGRectZero;
    if (!boundsDict ||
        !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds) ||
        CGRectIsEmpty(bounds)) {
        return NO;
    }

    if (boundsOut) {
        *boundsOut = bounds;
    }
    if (scaleFactorOut) {
        *scaleFactorOut = scaleFactorForBounds(bounds);
    }
    return YES;
}

static void emitBoundsEvent(CGRect bounds, CGFloat scaleFactor) {
    NSDictionary *payload = @{
        @"type": @"bounds",
        @"x": @(bounds.origin.x),
        @"y": @(bounds.origin.y),
        @"width": @(bounds.size.width),
        @"height": @(bounds.size.height),
        @"scaleFactor": @(scaleFactor),
    };

    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
    if (!json || error) {
        fprintf(stderr, "[CaptureEngine] failed to encode bounds event: %s\n",
                error.localizedDescription.UTF8String);
        return;
    }

    NSString *line = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    printf("%s\n", line.UTF8String);
    fflush(stdout);
}

static NSDictionary *CaptureAudioSettings(void) {
    return @{
        AVFormatIDKey: @(kAudioFormatMPEG4AAC),
        AVSampleRateKey: @48000,
        AVNumberOfChannelsKey: @2,
        AVEncoderBitRateKey: @192000,
    };
}

static NSInteger CaptureVideoAverageBitRate(size_t width, size_t height, NSInteger fps) {
    const double pixelsPerSecond = (double)MAX(width, 1) * (double)MAX(height, 1) * (double)MAX(fps, 1);
    // Screen content (text, UI) is far more compressible with HEVC than natural video.
    // At physical Retina resolution (e.g. 3360×2100) 0.07 bpp/frame ≈ 30 Mbps — visually
    // lossless, and well within VideoToolbox's real-time encoding capacity. The previous
    // 0.22 bpp produced 93 Mbps for Retina captures, exceeding the real-time encoder budget
    // and causing frame drops. Natural-video rules of thumb do not apply to screen recordings.
    const double bitsPerPixelFrame = 0.07;
    const double minimumBitRate = 20000000.0;   // 20 Mbps floor — generous for any resolution
    const double maximumBitRate = 100000000.0;  // 100 Mbps ceiling — covers 6K physical pixels
    const double targetBitRate = pixelsPerSecond * bitsPerPixelFrame;
    return (NSInteger)llround(MIN(MAX(targetBitRate, minimumBitRate), maximumBitRate));
}

static NSDictionary *CaptureVideoCompressionProperties(size_t width, size_t height, NSInteger fps) {
    return @{
        AVVideoAverageBitRateKey:          @(CaptureVideoAverageBitRate(width, height, fps)),
        AVVideoQualityKey:                 @(1.0),
        AVVideoExpectedSourceFrameRateKey: @(fps),
        AVVideoMaxKeyFrameIntervalKey:     @(MAX(fps * 2, 60)),
        AVVideoAllowFrameReorderingKey:    @NO,
    };
}

static NSDictionary *CaptureVideoSettings(size_t width, size_t height, NSInteger fps) {
    return @{
        AVVideoCodecKey:                 AVVideoCodecTypeHEVC,
        AVVideoWidthKey:                 @(width),
        AVVideoHeightKey:                @(height),
        AVVideoCompressionPropertiesKey: CaptureVideoCompressionProperties(width, height, fps),
    };
}

@implementation CaptureEngine

- (instancetype)initWithDisplayIndex:(NSInteger)displayIndex
                           displayId:(CGDirectDisplayID)displayId
                        hasDisplayId:(BOOL)hasDisplayId
                            windowId:(CGWindowID)windowId
                         hasWindowId:(BOOL)hasWindowId
                 excludeWindowTitle:(NSString * _Nullable)title
                         outputPath:(NSString *)outputPath
                                fps:(NSInteger)fps {
    self = [super init];
    if (self) {
        _displayIndex = displayIndex;
        _displayId = displayId;
        _hasDisplayId = hasDisplayId;
        _windowId = windowId;
        _hasWindowId = hasWindowId;
        _excludeWindowTitle = title;
        _outputPath = outputPath;
        _fps = fps;
        _pauseOffset = kCMTimeZero;
        _pauseStart = kCMTimeInvalid;
        _framesWritten = 0;
        _loggedAppendFailure = NO;
        _sampleQueue = dispatch_queue_create("sf.capture.sample", DISPATCH_QUEUE_SERIAL);
        _lastWindowBounds = CGRectZero;
        _lastWindowScaleFactor = 1.0;
        _framesComplete = 0;
        _framesIdle = 0;
        _framesSynthetic = 0;
        _framesDropped = 0;
        _loggedFirstSynthetic = NO;
        _sessionWallStart = 0;
        _lastWrittenPTS = kCMTimeInvalid;
    }
    return self;
}

- (void)startWithCompletion:(void (^)(NSError * _Nullable))completion {
    API_AVAILABLE_BEGIN(macos(12.3))
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                              onScreenWindowsOnly:YES
                                                completionHandler:^(SCShareableContent *content, NSError *error) {
        if (error) {
            completion(error);
            return;
        }

        NSArray<SCDisplay *> *displays = content.displays;
        fprintf(stderr,
                "[CaptureEngine] shareable content: displays=%lu windows=%lu\n",
                (unsigned long)displays.count,
                (unsigned long)content.windows.count);
        if (content.windows.count == 0) {
            fprintf(stderr,
                    "[CaptureEngine] warning: no windows returned; verify Screen Recording permission for ScreenforgeCapture\n");
        }
        SCDisplay *display = nil;
        SCWindow *targetWindow = nil;

        if (self.hasWindowId) {
            for (SCWindow *candidate in content.windows) {
                if (candidate.windowID == self.windowId) {
                    targetWindow = candidate;
                    break;
                }
            }
            if (!targetWindow) {
                completion([NSError errorWithDomain:@"ScreenforgeCapture" code:3
                    userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:
                        @"Window id %u not found in shareable content",
                        self.windowId]}]);
                return;
            }

            CGRect windowBounds = CGRectZero;
            CGFloat scaleFactor = 1.0;
            if (!getWindowBounds(self.windowId, &windowBounds, &scaleFactor)) {
                completion([NSError errorWithDomain:@"ScreenforgeCapture" code:4
                    userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:
                        @"Window id %u has no readable bounds",
                        self.windowId]}]);
                return;
            }

            self.lastWindowBounds = windowBounds;
            self.lastWindowScaleFactor = scaleFactor;
            emitBoundsEvent(windowBounds, scaleFactor);

            // Capture at physical (Retina) pixel resolution so the recording source
            // is high-fidelity. The scaleFactor (e.g. 2.0 on Retina) converts logical
            // window points to physical pixels. The export pipeline downscales this to
            // the encoder target (e.g. 1080p) using GPU trilinear filtering, yielding
            // significantly crisper output than upscaling from a logical-resolution source.
            size_t captureWidth = (size_t)MAX(2, lround(windowBounds.size.width * scaleFactor));
            size_t captureHeight = (size_t)MAX(2, lround(windowBounds.size.height * scaleFactor));
            if ((captureWidth & 1) != 0) captureWidth += 1;
            if ((captureHeight & 1) != 0) captureHeight += 1;

            fprintf(stderr,
                    "[CaptureEngine] using window id=%u bounds=%.1fx%.1f@%.1f,%.1f capture=%zux%zu bitrate=%.1fMbps\n",
                    self.windowId,
                    windowBounds.size.width,
                    windowBounds.size.height,
                    windowBounds.origin.x,
                    windowBounds.origin.y,
                    captureWidth,
                    captureHeight,
                    CaptureVideoAverageBitRate(captureWidth, captureHeight, self.fps) / 1000000.0);

            SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:targetWindow];

            SCStreamConfiguration *streamConfig = [[SCStreamConfiguration alloc] init];
            streamConfig.width  = captureWidth;
            streamConfig.height = captureHeight;
            streamConfig.minimumFrameInterval = CMTimeMake(1, (int32_t)self.fps);
            streamConfig.showsCursor = NO;
            streamConfig.pixelFormat = kCVPixelFormatType_32BGRA;
            streamConfig.capturesAudio = YES;
            streamConfig.excludesCurrentProcessAudio = YES;
            streamConfig.sampleRate = 48000;
            streamConfig.channelCount = 2;

            NSURL *outputURL = [NSURL fileURLWithPath:self.outputPath];
            NSError *writerError = nil;
            AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:outputURL
                                                             fileType:AVFileTypeMPEG4
                                                                error:&writerError];
            if (writerError) {
                completion(writerError);
                return;
            }

            NSDictionary *videoSettings = CaptureVideoSettings(captureWidth, captureHeight, self.fps);
            AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                                                           outputSettings:videoSettings];
            input.expectsMediaDataInRealTime = YES;

            if (![writer canAddInput:input]) {
                completion([NSError errorWithDomain:@"ScreenforgeCapture" code:2
                    userInfo:@{NSLocalizedDescriptionKey: @"Cannot add video input to AVAssetWriter"}]);
                return;
            }
            [writer addInput:input];

            AVAssetWriterInput *audioInput =
                [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                   outputSettings:CaptureAudioSettings()];
            audioInput.expectsMediaDataInRealTime = YES;
            if ([writer canAddInput:audioInput]) {
                [writer addInput:audioInput];
            } else {
                completion([NSError errorWithDomain:@"ScreenforgeCapture" code:5
                    userInfo:@{NSLocalizedDescriptionKey: @"Cannot add audio input to AVAssetWriter"}]);
                return;
            }
            [writer startWriting];

            self.assetWriter = writer;
            self.videoInput  = input;
            self.audioInput  = audioInput;
            self.sessionStarted = NO;
            self.framesWritten = 0;
            self.loggedAppendFailure = NO;

            SCStream *stream = [[SCStream alloc] initWithFilter:filter
                                                  configuration:streamConfig
                                                       delegate:self];
            NSError *addOutputError = nil;
            [stream addStreamOutput:self type:SCStreamOutputTypeScreen
                   sampleHandlerQueue:self.sampleQueue error:&addOutputError];
            if (addOutputError) {
                completion(addOutputError);
                return;
            }
            NSError *addAudioOutputError = nil;
            [stream addStreamOutput:self type:SCStreamOutputTypeAudio
                   sampleHandlerQueue:self.sampleQueue error:&addAudioOutputError];
            if (addAudioOutputError) {
                completion(addAudioOutputError);
                return;
            }

            self.stream = stream;
            [self startBoundsPoll];
            [stream startCaptureWithCompletionHandler:^(NSError *startError) {
                completion(startError);
            }];
            return;
        }

        if (self.hasDisplayId) {
            for (SCDisplay *candidate in displays) {
                if (candidate.displayID == self.displayId) {
                    display = candidate;
                    break;
                }
            }
            if (!display) {
                fprintf(stderr,
                        "[CaptureEngine] warning: display id %u not found; falling back to display index %ld\n",
                        self.displayId,
                        (long)self.displayIndex);
            }
        }

        if (!display) {
            if (self.displayIndex < 0 || self.displayIndex >= (NSInteger)displays.count) {
                completion([NSError errorWithDomain:@"ScreenforgeCapture" code:1
                    userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:
                        @"Display index %ld out of range (found %lu)",
                        (long)self.displayIndex, (unsigned long)displays.count]}]);
                return;
            }
            display = displays[self.displayIndex];
        }

        // Capture at physical (Retina) pixel resolution: find the NSScreen matching
        // this display and multiply the SCDisplay logical dimensions by backingScaleFactor.
        // SCDisplay.width/height and CGDisplayPixelsWide return the HiDPI scaled (logical)
        // resolution (e.g. 1680 for a 3360-pixel-wide Retina display). Using physical pixels
        // gives the export pipeline a high-fidelity source to downscale from, producing
        // significantly crisper output on any target resolution.
        CGFloat displayScaleFactor = 1.0;
        for (NSScreen *screen in NSScreen.screens) {
            NSNumber *screenNum = screen.deviceDescription[@"NSScreenNumber"];
            if (screenNum && (CGDirectDisplayID)screenNum.unsignedIntValue == display.displayID) {
                displayScaleFactor = screen.backingScaleFactor > 0 ? screen.backingScaleFactor : 1.0;
                break;
            }
        }
        size_t captureWidth  = (size_t)round(display.width  * displayScaleFactor);
        size_t captureHeight = (size_t)round(display.height * displayScaleFactor);
        if (captureWidth == 0)  captureWidth  = (size_t)display.width;
        if (captureHeight == 0) captureHeight = (size_t)display.height;
        if ((captureWidth & 1) != 0 || (captureHeight & 1) != 0) {
            size_t adjustedWidth = captureWidth & ~(size_t)1;
            size_t adjustedHeight = captureHeight & ~(size_t)1;
            if (adjustedWidth < 2) adjustedWidth = 2;
            if (adjustedHeight < 2) adjustedHeight = 2;
            fprintf(stderr,
                    "[CaptureEngine] warning: odd display size %zux%zu; using even size %zux%zu for HEVC\n",
                    captureWidth, captureHeight, adjustedWidth, adjustedHeight);
            captureWidth = adjustedWidth;
            captureHeight = adjustedHeight;
        }

        fprintf(stderr,
                "[CaptureEngine] using display id=%u size=%zux%zu capture=%zux%zu bitrate=%.1fMbps (available=%lu)\n",
                display.displayID,
                (size_t)display.width,
                (size_t)display.height,
                captureWidth,
                captureHeight,
                CaptureVideoAverageBitRate(captureWidth, captureHeight, self.fps) / 1000000.0,
                (unsigned long)displays.count);

        NSMutableArray<SCWindow *> *excludedWindows = [NSMutableArray array];
        if (self.excludeWindowTitle) {
            for (SCWindow *win in content.windows) {
                if ([win.title isEqualToString:self.excludeWindowTitle]) {
                    [excludedWindows addObject:win];
                }
            }
            if (excludedWindows.count == 0) {
                fprintf(stderr, "[CaptureEngine] warning: no window found with title '%s'\n",
                        self.excludeWindowTitle.UTF8String);
            }
        }

        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display
                                                          excludingWindows:excludedWindows];

        SCStreamConfiguration *streamConfig = [[SCStreamConfiguration alloc] init];
        streamConfig.width  = captureWidth;
        streamConfig.height = captureHeight;
        streamConfig.minimumFrameInterval = CMTimeMake(1, (int32_t)self.fps);
        streamConfig.showsCursor = NO;
        streamConfig.pixelFormat = kCVPixelFormatType_32BGRA;
        streamConfig.capturesAudio = YES;
        streamConfig.excludesCurrentProcessAudio = YES;
        streamConfig.sampleRate = 48000;
        streamConfig.channelCount = 2;

        // Setup AVAssetWriter
        NSURL *outputURL = [NSURL fileURLWithPath:self.outputPath];
        NSError *writerError = nil;
        AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:outputURL
                                                         fileType:AVFileTypeMPEG4
                                                            error:&writerError];
        if (writerError) {
            completion(writerError);
            return;
        }

        NSDictionary *videoSettings = CaptureVideoSettings(captureWidth, captureHeight, self.fps);
        AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                                                       outputSettings:videoSettings];
        input.expectsMediaDataInRealTime = YES;

        if (![writer canAddInput:input]) {
            completion([NSError errorWithDomain:@"ScreenforgeCapture" code:2
                userInfo:@{NSLocalizedDescriptionKey: @"Cannot add video input to AVAssetWriter"}]);
            return;
        }
        [writer addInput:input];

        AVAssetWriterInput *audioInput =
            [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                               outputSettings:CaptureAudioSettings()];
        audioInput.expectsMediaDataInRealTime = YES;
        if ([writer canAddInput:audioInput]) {
            [writer addInput:audioInput];
        } else {
            completion([NSError errorWithDomain:@"ScreenforgeCapture" code:5
                userInfo:@{NSLocalizedDescriptionKey: @"Cannot add audio input to AVAssetWriter"}]);
            return;
        }
        [writer startWriting];

        self.assetWriter = writer;
        self.videoInput  = input;
        self.audioInput  = audioInput;
        self.sessionStarted = NO;
        self.framesWritten = 0;
        self.loggedAppendFailure = NO;

        // Create and start SCStream
        SCStream *stream = [[SCStream alloc] initWithFilter:filter
                                              configuration:streamConfig
                                                   delegate:self];
        NSError *addOutputError = nil;
        [stream addStreamOutput:self type:SCStreamOutputTypeScreen
               sampleHandlerQueue:self.sampleQueue error:&addOutputError];
        if (addOutputError) {
            completion(addOutputError);
            return;
        }
        NSError *addAudioOutputError = nil;
        [stream addStreamOutput:self type:SCStreamOutputTypeAudio
               sampleHandlerQueue:self.sampleQueue error:&addAudioOutputError];
        if (addAudioOutputError) {
            completion(addAudioOutputError);
            return;
        }

        self.stream = stream;
        [stream startCaptureWithCompletionHandler:^(NSError *startError) {
            completion(startError);
        }];
    }];
    API_AVAILABLE_END
}

- (void)stop {
    [self stopWithCompletion:nil];
}

- (void)stopWithCompletion:(dispatch_block_t _Nullable)completion {
    SCStream *stream = self.stream;
    self.stream = nil;
    if (self.boundsTimer) {
        dispatch_source_cancel(self.boundsTimer);
        self.boundsTimer = nil;
    }

    if (stream) {
        [stream stopCaptureWithCompletionHandler:^(NSError *error) {
            if (error) {
                fprintf(stderr, "[CaptureEngine] stopCapture error: %s\n",
                        error.localizedDescription.UTF8String);
            }
            dispatch_sync(self.sampleQueue, ^{
                // drain the queue before finalising
            });
            [self finalizeWriterWithCompletion:completion];
        }];
    } else {
        [self finalizeWriterWithCompletion:completion];
    }
}

- (void)startBoundsPoll {
    if (!self.hasWindowId || self.boundsTimer) {
        return;
    }

    dispatch_source_t timer = dispatch_source_create(
        DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(
        timer,
        dispatch_time(DISPATCH_TIME_NOW, 0),
        100 * NSEC_PER_MSEC,
        20 * NSEC_PER_MSEC);

    __weak CaptureEngine *weakSelf = self;
    dispatch_source_set_event_handler(timer, ^{
        CaptureEngine *strongSelf = weakSelf;
        if (!strongSelf || !strongSelf.hasWindowId) {
            return;
        }

        CGRect bounds = CGRectZero;
        CGFloat scaleFactor = 1.0;
        if (!getWindowBounds(strongSelf.windowId, &bounds, &scaleFactor)) {
            return;
        }

        if (RectsNearlyEqual(bounds, strongSelf.lastWindowBounds) &&
            fabs(scaleFactor - strongSelf.lastWindowScaleFactor) < 0.01) {
            return;
        }

        strongSelf.lastWindowBounds = bounds;
        strongSelf.lastWindowScaleFactor = scaleFactor;
        emitBoundsEvent(bounds, scaleFactor);
    });
    dispatch_resume(timer);
    self.boundsTimer = timer;
}

- (void)finalizeWriterWithCompletion:(dispatch_block_t _Nullable)completion {
    AVAssetWriterInput *videoInput = self.videoInput;
    AVAssetWriterInput *audioInput = self.audioInput;
    AVAssetWriter *writer = self.assetWriter;
    self.videoInput  = nil;
    self.audioInput  = nil;
    self.assetWriter = nil;

    if (self.lastCompletePixelBuffer) {
        CVPixelBufferRelease(self.lastCompletePixelBuffer);
        self.lastCompletePixelBuffer = NULL;
    }

    if (!writer) {
        if (completion) completion();
        return;
    }

    double elapsed = self.sessionWallStart > 0 ? CACurrentMediaTime() - self.sessionWallStart : 0;
    double effectiveFps = elapsed > 0 ? (double)self.framesWritten / elapsed : 0.0;

    if (self.framesWritten == 0) {
        fprintf(stderr, "[CaptureEngine] warning: finalizing with zero frames written\n");
    } else {
        fprintf(stderr,
                "[CaptureEngine] finalizing — written=%lu complete=%lu idle=%lu synthetic=%lu "
                "dropped=%lu duration=%.1fs effectiveFps=%.1f (target=%ld)\n",
                (unsigned long)self.framesWritten,
                (unsigned long)self.framesComplete,
                (unsigned long)self.framesIdle,
                (unsigned long)self.framesSynthetic,
                (unsigned long)self.framesDropped,
                elapsed,
                effectiveFps,
                (long)self.fps);
    }

    [videoInput markAsFinished];
    [audioInput markAsFinished];
    [writer finishWritingWithCompletionHandler:^{
        if (writer.status != AVAssetWriterStatusCompleted && writer.error) {
            fprintf(stderr, "[CaptureEngine] finishWriting error: %s\n",
                    writer.error.localizedDescription.UTF8String);
        }
        if (completion) completion();
    }];
}

- (void)pause {
    if (self.isPaused) return;
    self.isPaused  = YES;
    self.pauseStart = CMClockGetTime(CMClockGetHostTimeClock());
}

- (void)resume {
    if (!self.isPaused) return;
    self.isPaused = NO;
    CMTime now = CMClockGetTime(CMClockGetHostTimeClock());
    if (CMTIME_IS_VALID(self.pauseStart)) {
        CMTime delta = CMTimeSubtract(now, self.pauseStart);
        self.pauseOffset = CMTimeAdd(self.pauseOffset, delta);
    }
    self.pauseStart = kCMTimeInvalid;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Logs a warning if the gap since the last written frame exceeds ~50 ms (3+ frames at 60 fps).
- (void)logFrameGapIfNeeded:(CMTime)pts {
    if (!CMTIME_IS_VALID(self.lastWrittenPTS)) return;
    double gapSec = CMTimeGetSeconds(CMTimeSubtract(pts, self.lastWrittenPTS));
    if (gapSec > 0.050) {
        fprintf(stderr,
                "[CaptureEngine] frame gap detected: %.1f ms (expected ≤16.7 ms at 60fps) "
                "after %lu frames written\n",
                gapSec * 1000.0,
                (unsigned long)self.framesWritten);
    }
}

/// Logs cumulative frame stats once every 60 written frames.
- (void)logPeriodicStatsIfNeeded {
    if (self.framesWritten % 60 != 0) return;

    double elapsed = CACurrentMediaTime() - self.sessionWallStart;
    double effectiveFps = elapsed > 0 ? (double)self.framesWritten / elapsed : 0.0;

    fprintf(stderr,
            "[CaptureEngine] stats @%lu frames — complete=%lu idle=%lu synthetic=%lu dropped=%lu "
            "effectiveFps=%.1f (target=%ld)\n",
            (unsigned long)self.framesWritten,
            (unsigned long)self.framesComplete,
            (unsigned long)self.framesIdle,
            (unsigned long)self.framesSynthetic,
            (unsigned long)self.framesDropped,
            effectiveFps,
            (long)self.fps);
}

/// Wraps an existing CVPixelBuffer in a new, ready-to-use CMSampleBuffer with
/// the supplied timing.  Returns NULL on error; caller must CFRelease the result.
- (CMSampleBufferRef _Nullable)sampleBufferFromPixelBuffer:(CVPixelBufferRef)pixelBuffer
                                               withTiming:(CMSampleTimingInfo)timing {
    CMVideoFormatDescriptionRef fmt = NULL;
    if (CMVideoFormatDescriptionCreateForImageBuffer(kCFAllocatorDefault, pixelBuffer, &fmt) != noErr || !fmt) {
        return NULL;
    }
    CMSampleBufferRef buf = NULL;
    CMSampleBufferCreateReadyWithImageBuffer(kCFAllocatorDefault, pixelBuffer, fmt, &timing, &buf);
    CFRelease(fmt);
    return buf;
}

// ── SCStreamOutput ────────────────────────────────────────────────────────────

- (void)stream:(SCStream *)stream
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        ofType:(SCStreamOutputType)type API_AVAILABLE(macos(12.3)) {
    if (self.isPaused) return;
    if (!self.assetWriter) return;
    if (self.assetWriter.status != AVAssetWriterStatusWriting) return;

    if (type == SCStreamOutputTypeAudio) {
        if (!self.audioInput || !self.sessionStarted) return;

        CMSampleBufferRef adjustedAudio = [self adjustedSampleBuffer:sampleBuffer];
        CMSampleBufferRef audioToWrite = adjustedAudio ? adjustedAudio : sampleBuffer;

        if (self.audioInput.isReadyForMoreMediaData) {
            [self.audioInput appendSampleBuffer:audioToWrite];
        }

        if (adjustedAudio) {
            CFRelease(adjustedAudio);
        }
        return;
    }

    if (type != SCStreamOutputTypeScreen) return;
    if (!self.videoInput) return;

    NSArray<NSDictionary *> *attachments =
        (__bridge NSArray<NSDictionary *> *)CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, NO);
    NSNumber *statusNumber = attachments.firstObject[SCStreamFrameInfoStatus];
    NSInteger frameStatus = statusNumber ? statusNumber.integerValue : SCFrameStatusComplete;

    // SCFrameStatusIdle: window content unchanged — SCKit delivers no pixel buffer.
    // Re-wrap the last complete frame's pixel buffer with the idle frame's timestamp
    // so AVAssetWriter receives a valid frame and maintains 60 fps during static windows.
    if (frameStatus == SCFrameStatusIdle) {
        self.framesIdle += 1;

        if (!self.lastCompletePixelBuffer || !self.sessionStarted) return;

        CMSampleTimingInfo timing;
        if (CMSampleBufferGetSampleTimingInfo(sampleBuffer, 0, &timing) != noErr) return;

        if (!CMTIME_COMPARE_INLINE(self.pauseOffset, ==, kCMTimeZero)) {
            timing.presentationTimeStamp = CMTimeSubtract(timing.presentationTimeStamp, self.pauseOffset);
            if (CMTIME_IS_VALID(timing.decodeTimeStamp)) {
                timing.decodeTimeStamp = CMTimeSubtract(timing.decodeTimeStamp, self.pauseOffset);
            }
        }

        CMSampleBufferRef synthetic = [self sampleBufferFromPixelBuffer:self.lastCompletePixelBuffer
                                                            withTiming:timing];
        if (synthetic) {
            if (self.videoInput.isReadyForMoreMediaData) {
                if ([self.videoInput appendSampleBuffer:synthetic]) {
                    self.framesWritten += 1;
                    self.framesSynthetic += 1;

                    if (!self.loggedFirstSynthetic) {
                        self.loggedFirstSynthetic = YES;
                        fprintf(stderr, "[CaptureEngine] first synthetic frame written at pts=%.3f\n",
                                CMTimeGetSeconds(timing.presentationTimeStamp));
                    }

                    [self logFrameGapIfNeeded:timing.presentationTimeStamp];
                    self.lastWrittenPTS = timing.presentationTimeStamp;
                    [self logPeriodicStatsIfNeeded];
                }
            } else {
                self.framesDropped += 1;
                fprintf(stderr, "[CaptureEngine] dropped synthetic idle frame — writer not ready "
                        "(written=%lu dropped=%lu)\n",
                        (unsigned long)self.framesWritten,
                        (unsigned long)self.framesDropped);
            }
            CFRelease(synthetic);
        }
        return;
    }

    if (frameStatus != SCFrameStatusComplete) {
        fprintf(stderr, "[CaptureEngine] skipping frame with unexpected status=%ld\n", (long)frameStatus);
        return;
    }

    self.framesComplete += 1;

    // Cache pixel buffer so idle frames can borrow it.
    CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (pb) {
        if (self.lastCompletePixelBuffer) CVPixelBufferRelease(self.lastCompletePixelBuffer);
        CVPixelBufferRetain(pb);
        self.lastCompletePixelBuffer = pb;
    }

    CMSampleBufferRef adjusted = [self adjustedSampleBuffer:sampleBuffer];
    CMSampleBufferRef toWrite  = adjusted ? adjusted : sampleBuffer;

    if (!self.sessionStarted) {
        CMTime pts = CMSampleBufferGetPresentationTimeStamp(toWrite);
        [self.assetWriter startSessionAtSourceTime:pts];
        self.sessionStarted = YES;
        self.sessionWallStart = CACurrentMediaTime();
        self.lastWrittenPTS = pts;
        fprintf(stderr, "Recording started\n");
    }

    if (self.videoInput.isReadyForMoreMediaData) {
        BOOL appended = [self.videoInput appendSampleBuffer:toWrite];
        if (appended) {
            self.framesWritten += 1;

            CMTime pts = CMSampleBufferGetPresentationTimeStamp(toWrite);
            [self logFrameGapIfNeeded:pts];
            self.lastWrittenPTS = pts;
            [self logPeriodicStatsIfNeeded];
        } else if (!self.loggedAppendFailure) {
            self.loggedAppendFailure = YES;
            if (self.assetWriter.error) {
                fprintf(stderr, "[CaptureEngine] appendSampleBuffer failed: %s\n",
                        self.assetWriter.error.localizedDescription.UTF8String);
            } else {
                fprintf(stderr, "[CaptureEngine] appendSampleBuffer failed (unknown error)\n");
            }
        }
    } else {
        self.framesDropped += 1;
        fprintf(stderr, "[CaptureEngine] dropped complete frame — writer not ready "
                "(written=%lu dropped=%lu)\n",
                (unsigned long)self.framesWritten,
                (unsigned long)self.framesDropped);
    }

    if (adjusted) {
        CFRelease(adjusted);
    }
}

// ── SCStreamDelegate ──────────────────────────────────────────────────────────

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    fprintf(stderr, "[CaptureEngine] stream stopped with error: %s (domain=%s code=%ld)\n",
            error.localizedDescription.UTF8String,
            error.domain.UTF8String,
            (long)error.code);
    // Nil self.stream on the main queue so that when stopWithCompletion: is later called
    // by the Electron process it skips stopCaptureWithCompletionHandler: (which would fail
    // with a misleading "stream already stopped" error) and goes straight to finalising the
    // AVAssetWriter with whatever frames were captured up to this point.
    dispatch_async(dispatch_get_main_queue(), ^{
        self.stream = nil;
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

- (CMSampleBufferRef _Nullable)adjustedSampleBuffer:(CMSampleBufferRef)buffer {
    if (CMTIME_COMPARE_INLINE(self.pauseOffset, ==, kCMTimeZero)) return nil;

    CMSampleTimingInfo timing;
    if (CMSampleBufferGetSampleTimingInfo(buffer, 0, &timing) != noErr) return nil;

    timing.presentationTimeStamp = CMTimeSubtract(timing.presentationTimeStamp, self.pauseOffset);
    if (CMTIME_IS_VALID(timing.decodeTimeStamp)) {
        timing.decodeTimeStamp = CMTimeSubtract(timing.decodeTimeStamp, self.pauseOffset);
    }

    CMSampleBufferRef adjusted = NULL;
    CMSampleBufferCreateCopyWithNewTiming(NULL, buffer, 1, &timing, &adjusted);
    return adjusted;
}

@end
