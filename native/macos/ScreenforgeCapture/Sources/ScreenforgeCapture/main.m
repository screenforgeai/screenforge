#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ApplicationServices/ApplicationServices.h>
#import <signal.h>
#import <stdlib.h>
#import <string.h>
#import "CaptureEngine.h"
#import "EventMonitor.h"

// ── Globals ───────────────────────────────────────────────────────────────────

static CaptureEngine *gEngine    = nil;
static EventMonitor  *gMonitor   = nil;
static BOOL           gShutdown  = NO;

// ── Argument parsing ──────────────────────────────────────────────────────────

typedef struct {
    NSInteger   displayIndex;
    CGDirectDisplayID displayId;
    BOOL        hasDisplayId;
    CGWindowID  windowId;
    BOOL        hasWindowId;
    BOOL        listWindows;
    BOOL        checkScreenAccess;
    BOOL        requestScreenAccess;
    NSString   *excludeWindowTitle;
    NSString   *outputPath;
    NSInteger   fps;
} Config;

static Config parseArgs(int argc, const char *argv[]) {
    Config cfg = {
        .displayIndex = 0,
        .displayId = 0,
        .hasDisplayId = NO,
        .windowId = 0,
        .hasWindowId = NO,
        .listWindows = NO,
        .checkScreenAccess = NO,
        .requestScreenAccess = NO,
        .excludeWindowTitle = nil,
        .outputPath = nil,
        .fps = 60
    };
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--display") == 0 && i + 1 < argc) {
            cfg.displayIndex = atol(argv[++i]);
        } else if (strcmp(argv[i], "--display-id") == 0 && i + 1 < argc) {
            unsigned long value = strtoul(argv[++i], NULL, 10);
            cfg.displayId = (CGDirectDisplayID)value;
            cfg.hasDisplayId = YES;
        } else if (strcmp(argv[i], "--window-id") == 0 && i + 1 < argc) {
            unsigned long value = strtoul(argv[++i], NULL, 10);
            cfg.windowId = (CGWindowID)value;
            cfg.hasWindowId = YES;
        } else if (strcmp(argv[i], "--list-windows") == 0) {
            cfg.listWindows = YES;
        } else if (strcmp(argv[i], "--check-screen-access") == 0) {
            cfg.checkScreenAccess = YES;
        } else if (strcmp(argv[i], "--request-screen-access") == 0) {
            cfg.requestScreenAccess = YES;
        } else if (strcmp(argv[i], "--exclude-window-title") == 0 && i + 1 < argc) {
            cfg.excludeWindowTitle = [NSString stringWithUTF8String:argv[++i]];
        } else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            cfg.outputPath = [NSString stringWithUTF8String:argv[++i]];
        } else if (strcmp(argv[i], "--fps") == 0 && i + 1 < argc) {
            cfg.fps = atol(argv[++i]);
        }
    }
    return cfg;
}

static BOOL ensureScreenCapturePermission(void) {
    if (CGPreflightScreenCaptureAccess()) {
        return YES;
    }

    fprintf(stderr,
            "[ScreenforgeCapture] Screen Recording permission is missing for the helper process.\n");
    fprintf(stderr,
            "[ScreenforgeCapture] Requesting permission...\n");

    BOOL granted = CGRequestScreenCaptureAccess();
    if (granted && CGPreflightScreenCaptureAccess()) {
        fprintf(stderr, "[ScreenforgeCapture] Screen Recording permission granted.\n");
        return YES;
    }

    fprintf(stderr,
            "[ScreenforgeCapture] Permission denied. Enable ScreenforgeCapture/Screenforge in System Settings > Privacy & Security > Screen Recording.\n");
    return NO;
}

static int printScreenCapturePermissionStatus(BOOL shouldRequest) {
    BOOL granted = CGPreflightScreenCaptureAccess();
    if (!granted && shouldRequest) {
        granted = CGRequestScreenCaptureAccess() && CGPreflightScreenCaptureAccess();
    }

    const char *status = granted ? "granted" : "denied";
    fprintf(stdout, "%s\n", status);
    fflush(stdout);
    return granted ? 0 : 1;
}

static BOOL ensureAccessibilityPermission(void) {
    if (AXIsProcessTrusted()) {
        return YES;
    }

    fprintf(stderr,
            "[ScreenforgeCapture] Accessibility permission is missing; cursor/zoom tracking requires it.\n");
    fprintf(stderr,
            "[ScreenforgeCapture] Enable ScreenforgeCapture/Screenforge in System Settings > Privacy & Security > Accessibility.\n");
    return NO;
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

static int listWindows(void) {
    CFArrayRef windowInfoRef = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );
    NSArray *windowInfo = CFBridgingRelease(windowInfoRef);
    NSMutableDictionary<NSString *, NSDictionary *> *windows = [NSMutableDictionary dictionary];

    for (NSDictionary *entry in windowInfo) {
        NSNumber *windowNumber = entry[(id)kCGWindowNumber];
        if (!windowNumber) {
            continue;
        }

        CGRect bounds = CGRectZero;
        NSDictionary *boundsDict = entry[(id)kCGWindowBounds];
        if (boundsDict &&
            !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds)) {
            bounds = CGRectZero;
        }
        if (CGRectIsEmpty(bounds)) {
            continue;
        }

        NSNumber *ownerPid = entry[(id)kCGWindowOwnerPID];
        NSRunningApplication *ownerApp = ownerPid
            ? [NSRunningApplication runningApplicationWithProcessIdentifier:ownerPid.intValue]
            : nil;
        NSString *ownerName = ownerApp.localizedName ?: entry[(id)kCGWindowOwnerName];
        NSString *windowTitle = entry[(id)kCGWindowName];
        NSString *bundleId = ownerApp.bundleIdentifier;

        NSMutableDictionary *windowData = [NSMutableDictionary dictionary];
        windowData[@"windowID"] = windowNumber;

        if (ownerName.length > 0) {
            windowData[@"appName"] = ownerName;
        }
        if (windowTitle.length > 0) {
            windowData[@"windowTitle"] = windowTitle;
        }
        if (bundleId.length > 0) {
            windowData[@"bundleId"] = bundleId;
        }
        windowData[@"x"] = @(bounds.origin.x);
        windowData[@"y"] = @(bounds.origin.y);
        windowData[@"width"] = @(bounds.size.width);
        windowData[@"height"] = @(bounds.size.height);
        windowData[@"scaleFactor"] = @(scaleFactorForBounds(bounds));

        windows[windowNumber.stringValue] = windowData;
    }

    NSError *jsonError = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{ @"windows": windows }
                                                   options:0
                                                     error:&jsonError];
    if (!json || jsonError) {
        fprintf(stderr, "ScreenforgeCapture list-windows error: %s\n",
                jsonError.localizedDescription.UTF8String);
        return 1;
    }

    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    return 0;
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

static void gracefulShutdown(void) {
    if (gShutdown) return;
    gShutdown = YES;

    [gMonitor stop];

    // stopNativeCapture sends SIGTERM; CaptureEngine.stop() finalises AVAssetWriter
    if (gEngine) {
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        void (^stopBlock)(void) = ^{
            [gEngine stopWithCompletion:^{
                dispatch_semaphore_signal(sem);
            }];
        };

        if ([NSThread isMainThread]) {
            stopBlock();
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10.0];
            while (dispatch_semaphore_wait(sem, DISPATCH_TIME_NOW) != 0 &&
                   [deadline timeIntervalSinceNow] > 0) {
                [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                         beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
            }
        } else {
            dispatch_sync(dispatch_get_main_queue(), stopBlock);
            dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        }
    }

    exit(0);
}

static void signalHandler(int sig) {
    (void)sig;
    // Must not call ObjC from signal context directly; schedule on main thread
    dispatch_async(dispatch_get_main_queue(), ^{
        gracefulShutdown();
    });
}

// ── stdin reader ──────────────────────────────────────────────────────────────

static void startStdinReader(void) {
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        char buf[256];
        while (fgets(buf, sizeof(buf), stdin)) {
            NSString *line = [[NSString stringWithUTF8String:buf]
                              stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if ([line isEqualToString:@"pause"]) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [gEngine pause];
                    [gMonitor pause];
                });
            } else if ([line isEqualToString:@"resume"]) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [gEngine resume];
                    [gMonitor resume];
                });
            }
        }
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        Config cfg = parseArgs(argc, argv);

        if (cfg.checkScreenAccess) {
            return printScreenCapturePermissionStatus(NO);
        }

        if (cfg.requestScreenAccess) {
            [NSApplication sharedApplication];
            return printScreenCapturePermissionStatus(YES);
        }

        if (cfg.listWindows) {
            [NSApplication sharedApplication];
            if (!ensureScreenCapturePermission()) {
                return 1;
            }
            return listWindows();
        }

        if (!cfg.outputPath) {
            fprintf(stderr, "ScreenforgeCapture: --output <path> is required\n");
            return 1;
        }

        if (!ensureScreenCapturePermission()) {
            return 1;
        }
        if (!ensureAccessibilityPermission()) {
            fprintf(stderr,
                    "[ScreenforgeCapture] Continuing without event tap; recording will not include cursor/click analytics.\n");
        }

        signal(SIGTERM, signalHandler);
        signal(SIGINT,  signalHandler);

        // Need NSApplication for NSCursor / AppKit polling on main thread
        [NSApplication sharedApplication];

        gEngine  = [[CaptureEngine alloc] initWithDisplayIndex:cfg.displayIndex
                                                      displayId:cfg.displayId
                                                   hasDisplayId:cfg.hasDisplayId
                                                       windowId:cfg.windowId
                                                    hasWindowId:cfg.hasWindowId
                                            excludeWindowTitle:cfg.excludeWindowTitle
                                                    outputPath:cfg.outputPath
                                                           fps:cfg.fps];
        gMonitor = [[EventMonitor alloc] init];

        startStdinReader();

        [gEngine startWithCompletion:^(NSError *error) {
            if (error) {
                fprintf(stderr, "ScreenforgeCapture start error: %s\n",
                        error.localizedDescription.UTF8String);
                exit(1);
            }
            dispatch_async(dispatch_get_main_queue(), ^{
                [gMonitor start];
            });
        }];

        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
