#pragma once
#import <Foundation/Foundation.h>

@interface EventMonitor : NSObject

- (void)start;
- (void)stop;
- (void)pause;
- (void)resume;

@end
