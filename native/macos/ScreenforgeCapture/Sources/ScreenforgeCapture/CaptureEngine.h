#pragma once
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>

@interface CaptureEngine : NSObject <SCStreamDelegate>

- (instancetype)initWithDisplayIndex:(NSInteger)displayIndex
                           displayId:(CGDirectDisplayID)displayId
                        hasDisplayId:(BOOL)hasDisplayId
                            windowId:(CGWindowID)windowId
                         hasWindowId:(BOOL)hasWindowId
                 excludeWindowTitle:(NSString * _Nullable)title
                         outputPath:(NSString *)outputPath
                                fps:(NSInteger)fps;

- (void)startWithCompletion:(void (^)(NSError * _Nullable error))completion;
- (void)stop;
- (void)stopWithCompletion:(dispatch_block_t _Nullable)completion;
- (void)pause;
- (void)resume;

@end
