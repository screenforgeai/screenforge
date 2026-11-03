#import "EventMonitor.h"
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Carbon/Carbon.h>

// ── Cursor type mapping ───────────────────────────────────────────────────────

static BOOL cursorMatches(NSCursor *cursor, NSCursor *candidate) {
    if (!cursor || !candidate) {
        return NO;
    }
    if (cursor == candidate || [cursor isEqual:candidate]) {
        return YES;
    }

    // AppKit may hand back equivalent cursor instances that are not pointer-identical.
    NSImage *cursorImage = cursor.image;
    NSImage *candidateImage = candidate.image;
    if (!cursorImage || !candidateImage) {
        return NO;
    }

    if ([cursorImage isEqual:candidateImage] && NSEqualPoints(cursor.hotSpot, candidate.hotSpot)) {
        return YES;
    }

    // NSImage -isEqual is often too strict for cursor assets. Compare bytes as fallback.
    NSData *cursorTIFF = [cursorImage TIFFRepresentation];
    NSData *candidateTIFF = [candidateImage TIFFRepresentation];
    if (!cursorTIFF || !candidateTIFF) {
        return NO;
    }

    return [cursorTIFF isEqualToData:candidateTIFF] && NSEqualPoints(cursor.hotSpot, candidate.hotSpot);
}

static BOOL almostEqual(CGFloat a, CGFloat b) {
    CGFloat diff = a > b ? (a - b) : (b - a);
    return diff <= 0.5;
}

static NSString *fallbackCursorTypeByMetrics(NSCursor *cursor) {
    if (!cursor || !cursor.image) {
        return nil;
    }

    NSSize imageSize = cursor.image.size;
    NSPoint hotspot = cursor.hotSpot;
    CGFloat w = imageSize.width;
    CGFloat h = imageSize.height;
    CGFloat hx = hotspot.x;
    CGFloat hy = hotspot.y;

    // Typical I-beam profile observed on macOS Sonoma.
    if (almostEqual(w, 9.0) && almostEqual(h, 18.0) && almostEqual(hx, 4.0) && almostEqual(hy, 9.0)) {
        return @"text";
    }

    // Typical pointing hand profile observed on macOS Sonoma.
    if (almostEqual(w, 32.0) && almostEqual(h, 32.0) && almostEqual(hx, 13.0) && almostEqual(hy, 8.0)) {
        return @"pointer";
    }

    return nil;
}

static NSString *nsCursorType(NSCursor *cursor) {
    if (cursorMatches(cursor, [NSCursor arrowCursor]))                  return @"default";
    if (cursorMatches(cursor, [NSCursor IBeamCursor]))                  return @"text";
    if (cursorMatches(cursor, [NSCursor IBeamCursorForVerticalLayout])) return @"text";
    if (cursorMatches(cursor, [NSCursor pointingHandCursor]))           return @"pointer";
    if (cursorMatches(cursor, [NSCursor dragLinkCursor]))               return @"pointer";
    if (cursorMatches(cursor, [NSCursor dragCopyCursor]))               return @"pointer";
    if (cursorMatches(cursor, [NSCursor crosshairCursor]))              return @"crosshair";
    if (cursorMatches(cursor, [NSCursor openHandCursor]))               return @"grab";
    if (cursorMatches(cursor, [NSCursor closedHandCursor]))             return @"grab";
    if (cursorMatches(cursor, [NSCursor resizeLeftCursor]))             return @"resize";
    if (cursorMatches(cursor, [NSCursor resizeRightCursor]))            return @"resize";
    if (cursorMatches(cursor, [NSCursor resizeUpCursor]))               return @"resize";
    if (cursorMatches(cursor, [NSCursor resizeDownCursor]))             return @"resize";
    if (cursorMatches(cursor, [NSCursor resizeLeftRightCursor]))        return @"resize";
    if (cursorMatches(cursor, [NSCursor resizeUpDownCursor]))           return @"resize";

    NSString *fallback = fallbackCursorTypeByMetrics(cursor);
    if (fallback) {
        return fallback;
    }

    return @"default";
}

// ── JSON emission ─────────────────────────────────────────────────────────────

static NSNumber *eventTimestamp(void) {
    NSTimeInterval seconds = [[NSDate date] timeIntervalSince1970];
    return @((long long)llround(seconds * 1000.0));
}

static BOOL hasCommandModifier(CGEventFlags flags) {
    return (flags & kCGEventFlagMaskCommand) ||
           (flags & kCGEventFlagMaskControl) ||
           (flags & kCGEventFlagMaskAlternate);
}

static NSString *keyCategoryForKeycode(CGKeyCode keycode, CGEventFlags flags) {
    BOOL shortcut = hasCommandModifier(flags);

    switch (keycode) {
        case kVK_Shift:
        case kVK_RightShift:
        case kVK_Control:
        case kVK_RightControl:
        case kVK_Option:
        case kVK_RightOption:
        case kVK_Command:
        case kVK_RightCommand:
        case kVK_CapsLock:
        case kVK_Function:
            return @"modifier";

        case kVK_Space:
        case kVK_Tab:
            return shortcut ? @"shortcut" : @"whitespace";

        case kVK_Return:
        case kVK_ANSI_KeypadEnter:
            return shortcut ? @"shortcut" : @"enter";

        case kVK_Delete:
        case kVK_ForwardDelete:
            return shortcut ? @"shortcut" : @"delete";

        case kVK_LeftArrow:
        case kVK_RightArrow:
        case kVK_UpArrow:
        case kVK_DownArrow:
        case kVK_PageUp:
        case kVK_PageDown:
        case kVK_Home:
        case kVK_End:
        case kVK_Help:
            return shortcut ? @"shortcut" : @"navigation";

        case kVK_Escape:
        case kVK_F1:
        case kVK_F2:
        case kVK_F3:
        case kVK_F4:
        case kVK_F5:
        case kVK_F6:
        case kVK_F7:
        case kVK_F8:
        case kVK_F9:
        case kVK_F10:
        case kVK_F11:
        case kVK_F12:
        case kVK_F13:
        case kVK_F14:
        case kVK_F15:
        case kVK_F16:
        case kVK_F17:
        case kVK_F18:
        case kVK_F19:
        case kVK_F20:
        case kVK_VolumeUp:
        case kVK_VolumeDown:
        case kVK_Mute:
            return @"system";

        default:
            break;
    }

    BOOL ansiOrKeypad =
        (keycode >= kVK_ANSI_A && keycode <= kVK_ANSI_Grave) ||
        (keycode >= kVK_ANSI_KeypadDecimal && keycode <= kVK_ANSI_Keypad9) ||
        keycode == kVK_ANSI_KeypadEquals ||
        keycode == kVK_ANSI_KeypadDivide ||
        keycode == kVK_ANSI_KeypadEnter;

    if (ansiOrKeypad) {
        return shortcut ? @"shortcut" : @"character";
    }

    return @"unknown";
}

static NSString *baseKeyLabelForKeycode(CGKeyCode keycode) {
    switch (keycode) {
        case kVK_Shift:
        case kVK_RightShift:
            return @"Shift";
        case kVK_Control:
        case kVK_RightControl:
            return @"Ctrl";
        case kVK_Option:
        case kVK_RightOption:
            return @"Option";
        case kVK_Command:
        case kVK_RightCommand:
            return @"Cmd";
        case kVK_CapsLock:
            return @"Caps Lock";
        case kVK_Function:
            return @"Fn";

        case kVK_Space:
            return @"Space";
        case kVK_Tab:
            return @"Tab";
        case kVK_Return:
        case kVK_ANSI_KeypadEnter:
            return @"Enter";
        case kVK_Delete:
            return @"Backspace";
        case kVK_ForwardDelete:
            return @"Delete";
        case kVK_LeftArrow:
            return @"Left";
        case kVK_RightArrow:
            return @"Right";
        case kVK_UpArrow:
            return @"Up";
        case kVK_DownArrow:
            return @"Down";
        case kVK_PageUp:
            return @"Page Up";
        case kVK_PageDown:
            return @"Page Down";
        case kVK_Home:
            return @"Home";
        case kVK_End:
            return @"End";
        case kVK_Help:
            return @"Help";
        case kVK_Escape:
            return @"Esc";

        case kVK_F1: return @"F1";
        case kVK_F2: return @"F2";
        case kVK_F3: return @"F3";
        case kVK_F4: return @"F4";
        case kVK_F5: return @"F5";
        case kVK_F6: return @"F6";
        case kVK_F7: return @"F7";
        case kVK_F8: return @"F8";
        case kVK_F9: return @"F9";
        case kVK_F10: return @"F10";
        case kVK_F11: return @"F11";
        case kVK_F12: return @"F12";
        case kVK_F13: return @"F13";
        case kVK_F14: return @"F14";
        case kVK_F15: return @"F15";
        case kVK_F16: return @"F16";
        case kVK_F17: return @"F17";
        case kVK_F18: return @"F18";
        case kVK_F19: return @"F19";
        case kVK_F20: return @"F20";
        case kVK_VolumeUp: return @"Volume Up";
        case kVK_VolumeDown: return @"Volume Down";
        case kVK_Mute: return @"Mute";

        case kVK_ANSI_A: return @"A";
        case kVK_ANSI_B: return @"B";
        case kVK_ANSI_C: return @"C";
        case kVK_ANSI_D: return @"D";
        case kVK_ANSI_E: return @"E";
        case kVK_ANSI_F: return @"F";
        case kVK_ANSI_G: return @"G";
        case kVK_ANSI_H: return @"H";
        case kVK_ANSI_I: return @"I";
        case kVK_ANSI_J: return @"J";
        case kVK_ANSI_K: return @"K";
        case kVK_ANSI_L: return @"L";
        case kVK_ANSI_M: return @"M";
        case kVK_ANSI_N: return @"N";
        case kVK_ANSI_O: return @"O";
        case kVK_ANSI_P: return @"P";
        case kVK_ANSI_Q: return @"Q";
        case kVK_ANSI_R: return @"R";
        case kVK_ANSI_S: return @"S";
        case kVK_ANSI_T: return @"T";
        case kVK_ANSI_U: return @"U";
        case kVK_ANSI_V: return @"V";
        case kVK_ANSI_W: return @"W";
        case kVK_ANSI_X: return @"X";
        case kVK_ANSI_Y: return @"Y";
        case kVK_ANSI_Z: return @"Z";
        case kVK_ANSI_0: return @"0";
        case kVK_ANSI_1: return @"1";
        case kVK_ANSI_2: return @"2";
        case kVK_ANSI_3: return @"3";
        case kVK_ANSI_4: return @"4";
        case kVK_ANSI_5: return @"5";
        case kVK_ANSI_6: return @"6";
        case kVK_ANSI_7: return @"7";
        case kVK_ANSI_8: return @"8";
        case kVK_ANSI_9: return @"9";
        case kVK_ANSI_Minus: return @"-";
        case kVK_ANSI_Equal: return @"=";
        case kVK_ANSI_LeftBracket: return @"[";
        case kVK_ANSI_RightBracket: return @"]";
        case kVK_ANSI_Semicolon: return @";";
        case kVK_ANSI_Quote: return @"'";
        case kVK_ANSI_Grave: return @"`";
        case kVK_ANSI_Backslash: return @"\\";
        case kVK_ANSI_Comma: return @",";
        case kVK_ANSI_Period: return @".";
        case kVK_ANSI_Slash: return @"/";
        case kVK_ANSI_Keypad0: return @"0";
        case kVK_ANSI_Keypad1: return @"1";
        case kVK_ANSI_Keypad2: return @"2";
        case kVK_ANSI_Keypad3: return @"3";
        case kVK_ANSI_Keypad4: return @"4";
        case kVK_ANSI_Keypad5: return @"5";
        case kVK_ANSI_Keypad6: return @"6";
        case kVK_ANSI_Keypad7: return @"7";
        case kVK_ANSI_Keypad8: return @"8";
        case kVK_ANSI_Keypad9: return @"9";
        case kVK_ANSI_KeypadDecimal: return @".";
        case kVK_ANSI_KeypadMinus: return @"-";
        case kVK_ANSI_KeypadPlus: return @"+";
        case kVK_ANSI_KeypadClear: return @"Clear";
        case kVK_ANSI_KeypadDivide: return @"/";
        case kVK_ANSI_KeypadMultiply: return @"*";
        case kVK_ANSI_KeypadEquals: return @"=";
        default:
            return nil;
    }
}

static BOOL hasAnyModifier(CGEventFlags flags) {
    return (flags & kCGEventFlagMaskCommand) ||
           (flags & kCGEventFlagMaskControl) ||
           (flags & kCGEventFlagMaskAlternate) ||
           (flags & kCGEventFlagMaskShift);
}

static BOOL keyCategoryAllowsLabel(NSString *category, CGEventFlags flags) {
    return [category isEqualToString:@"modifier"] ||
           [category isEqualToString:@"shortcut"] ||
           [category isEqualToString:@"navigation"] ||
           [category isEqualToString:@"system"] ||
           (([category isEqualToString:@"whitespace"] ||
             [category isEqualToString:@"enter"] ||
             [category isEqualToString:@"delete"]) &&
            hasAnyModifier(flags));
}

static NSString *safeKeyLabelForKeycode(CGKeyCode keycode, CGEventFlags flags, NSString *category) {
    NSString *label = baseKeyLabelForKeycode(keycode);
    if (!label) {
        return nil;
    }
    if (keyCategoryAllowsLabel(category, flags)) {
        return label;
    }
    if ([category isEqualToString:@"character"] && hasCommandModifier(flags)) {
        return label;
    }
    return nil;
}

static NSDictionary *modifierPayload(CGEventFlags flags) {
    return @{
        @"meta": @((flags & kCGEventFlagMaskCommand) != 0),
        @"ctrl": @((flags & kCGEventFlagMaskControl) != 0),
        @"alt": @((flags & kCGEventFlagMaskAlternate) != 0),
        @"shift": @((flags & kCGEventFlagMaskShift) != 0),
    };
}

static CGEventFlags modifierMaskForKeycode(CGKeyCode keycode) {
    switch (keycode) {
        case kVK_Shift:
        case kVK_RightShift:
            return kCGEventFlagMaskShift;
        case kVK_Control:
        case kVK_RightControl:
            return kCGEventFlagMaskControl;
        case kVK_Option:
        case kVK_RightOption:
            return kCGEventFlagMaskAlternate;
        case kVK_Command:
        case kVK_RightCommand:
            return kCGEventFlagMaskCommand;
        case kVK_CapsLock:
            return kCGEventFlagMaskAlphaShift;
        default:
            return 0;
    }
}

static void printJSON(NSDictionary *dict) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:dict options:0 error:&error];
    if (data) {
        NSString *line = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        printf("%s\n", line.UTF8String);
        fflush(stdout);
    }
}

static void emitEvent(NSString *type, double x, double y,
                      NSNumber * _Nullable deltaX, NSNumber * _Nullable deltaY,
                      NSString * _Nullable button, NSString *cursorType) {
    NSMutableDictionary *dict = [NSMutableDictionary dictionary];
    dict[@"type"]       = type;
    dict[@"x"]          = @(x);
    dict[@"y"]          = @(y);
    dict[@"timestamp"]  = eventTimestamp();
    dict[@"cursorType"] = cursorType;
    if (deltaX) dict[@"deltaX"] = deltaX;
    if (deltaY) dict[@"deltaY"] = deltaY;
    if (button) dict[@"button"] = button;

    printJSON(dict);
}

static void emitKeyEvent(NSString *type, CGEventRef event) {
    CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    CGEventFlags flags = CGEventGetFlags(event);
    BOOL repeat = CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) != 0;
    NSString *category = keyCategoryForKeycode(keycode, flags);
    NSString *keyLabel = safeKeyLabelForKeycode(keycode, flags, category);

    NSMutableDictionary *dict = [@{
        @"type": type,
        @"timestamp": eventTimestamp(),
        @"keyCategory": category,
        @"modifiers": modifierPayload(flags),
        @"repeat": @(repeat),
    } mutableCopy];
    if (keyLabel) {
        dict[@"keyLabel"] = keyLabel;
    }
    printJSON(dict);
}

// ── EventMonitor ──────────────────────────────────────────────────────────────

static EventMonitor *gMonitor = nil;

@interface EventMonitor ()
@property (nonatomic) CFMachPortRef eventTap;
@property (nonatomic) CFRunLoopSourceRef runLoopSource;
@property (nonatomic, strong) dispatch_source_t cursorTimer;
@property (nonatomic, copy) NSString *lastCursorType;
@property (nonatomic) BOOL isPaused;
@property (nonatomic) NSUInteger moveCount;
@property (nonatomic) NSUInteger downCount;
@property (nonatomic) NSUInteger upCount;
@property (nonatomic) NSUInteger scrollCount;
@property (nonatomic) NSUInteger keyDownCount;
@property (nonatomic) NSUInteger keyUpCount;
@end

@implementation EventMonitor

- (instancetype)init {
    self = [super init];
    if (self) {
        _lastCursorType = @"default";
    }
    return self;
}

- (void)start {
    gMonitor = self;
    [self startEventTap];
    [self startCursorPoll];
}

- (void)stop {
    fprintf(stderr,
            "[EventMonitor] summary: move=%lu down=%lu up=%lu scroll=%lu keydown=%lu keyup=%lu\n",
            (unsigned long)self.moveCount,
            (unsigned long)self.downCount,
            (unsigned long)self.upCount,
            (unsigned long)self.scrollCount,
            (unsigned long)self.keyDownCount,
            (unsigned long)self.keyUpCount);
    if (self.cursorTimer) {
        dispatch_source_cancel(self.cursorTimer);
        self.cursorTimer = nil;
    }
    if (self.runLoopSource) {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), self.runLoopSource, kCFRunLoopCommonModes);
        CFRelease(self.runLoopSource);
        self.runLoopSource = NULL;
    }
    if (self.eventTap) {
        CGEventTapEnable(self.eventTap, false);
        CFRelease(self.eventTap);
        self.eventTap = NULL;
    }
    gMonitor = nil;
}

- (void)pause  { self.isPaused = YES; }
- (void)resume { self.isPaused = NO;  }

// ── CGEventTap ────────────────────────────────────────────────────────────────

- (void)startEventTap {
    CGEventMask mask =
        CGEventMaskBit(kCGEventMouseMoved)      |
        CGEventMaskBit(kCGEventLeftMouseDown)   |
        CGEventMaskBit(kCGEventLeftMouseUp)     |
        CGEventMaskBit(kCGEventRightMouseDown)  |
        CGEventMaskBit(kCGEventRightMouseUp)    |
        CGEventMaskBit(kCGEventScrollWheel)     |
        CGEventMaskBit(kCGEventLeftMouseDragged)|
        CGEventMaskBit(kCGEventRightMouseDragged)|
        CGEventMaskBit(kCGEventKeyDown)         |
        CGEventMaskBit(kCGEventKeyUp)           |
        CGEventMaskBit(kCGEventFlagsChanged);

    CFMachPortRef tap = CGEventTapCreate(
        kCGSessionEventTap,
        kCGTailAppendEventTap,
        kCGEventTapOptionListenOnly,
        mask,
        eventCallback,
        (__bridge void *)self
    );

    if (!tap) {
        fprintf(stderr, "[EventMonitor] CGEventTapCreate failed — no cursor events will be emitted\n");
        return;
    }

    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(NULL, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetMain(), src, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    fprintf(stderr, "[EventMonitor] CGEventTap enabled\n");

    self.eventTap      = tap;
    self.runLoopSource = src;
}

static CGEventRef eventCallback(CGEventTapProxy proxy, CGEventType type,
                                CGEventRef event, void *refcon) {
    EventMonitor *monitor = (__bridge EventMonitor *)refcon;
    if (!monitor.isPaused) {
        [monitor handleEventType:type event:event];
    }
    return event;
}

- (void)handleEventType:(CGEventType)type event:(CGEventRef)event {
    CGPoint loc  = CGEventGetLocation(event);
    double  x    = loc.x;
    double  y    = loc.y;
    NSString *ct = self.lastCursorType;

    switch (type) {
        case kCGEventMouseMoved:
        case kCGEventLeftMouseDragged:
        case kCGEventRightMouseDragged:
            self.moveCount += 1;
            emitEvent(@"move", x, y, nil, nil, nil, ct);
            break;

        case kCGEventLeftMouseDown:
            self.downCount += 1;
            emitEvent(@"mousedown", x, y, nil, nil, @"left", ct);
            break;
        case kCGEventLeftMouseUp:
            self.upCount += 1;
            emitEvent(@"mouseup", x, y, nil, nil, @"left", ct);
            break;
        case kCGEventRightMouseDown:
            self.downCount += 1;
            emitEvent(@"mousedown", x, y, nil, nil, @"right", ct);
            break;
        case kCGEventRightMouseUp:
            self.upCount += 1;
            emitEvent(@"mouseup", x, y, nil, nil, @"right", ct);
            break;

        case kCGEventScrollWheel: {
            self.scrollCount += 1;
            double dy = CGEventGetDoubleValueField(event, kCGScrollWheelEventDeltaAxis1);
            double dx = CGEventGetDoubleValueField(event, kCGScrollWheelEventDeltaAxis2);
            emitEvent(@"scroll", x, y, @(dx), @(dy), nil, ct);
            break;
        }
        case kCGEventKeyDown:
            self.keyDownCount += 1;
            emitKeyEvent(@"keydown", event);
            break;
        case kCGEventKeyUp:
            self.keyUpCount += 1;
            emitKeyEvent(@"keyup", event);
            break;
        case kCGEventFlagsChanged: {
            CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
            CGEventFlags modifierMask = modifierMaskForKeycode(keycode);
            if (modifierMask != 0) {
                BOOL isDown = (CGEventGetFlags(event) & modifierMask) != 0;
                if (isDown) {
                    self.keyDownCount += 1;
                    emitKeyEvent(@"keydown", event);
                } else {
                    self.keyUpCount += 1;
                    emitKeyEvent(@"keyup", event);
                }
            }
            break;
        }
        default:
            break;
    }
}

// ── NSCursor polling ──────────────────────────────────────────────────────────

- (void)startCursorPoll {
    dispatch_source_t timer = dispatch_source_create(
        DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());

    dispatch_source_set_timer(timer,
        dispatch_time(DISPATCH_TIME_NOW, 0),
        33 * NSEC_PER_MSEC,
        5  * NSEC_PER_MSEC);

    __weak EventMonitor *weakSelf = self;
    dispatch_source_set_event_handler(timer, ^{
        [weakSelf pollCursor];
    });
    dispatch_resume(timer);
    self.cursorTimer = timer;
}

- (void)pollCursor {
    if (self.isPaused) return;

    NSCursor *current = [NSCursor currentSystemCursor];
    if (!current) return;

    NSString *ct = nsCursorType(current);
    if (![ct isEqualToString:self.lastCursorType]) {
        self.lastCursorType = ct;
        NSPoint loc = [NSEvent mouseLocation];
        emitEvent(@"move", loc.x, loc.y, nil, nil, nil, ct);
    }
}

@end
