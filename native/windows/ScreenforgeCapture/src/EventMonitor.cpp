#include "EventMonitor.h"

#include <cstdio>
#include <cstring>
#include <cinttypes>

// ── Static instance ───────────────────────────────────────────────────────────

EventMonitor* EventMonitor::s_instance = nullptr;

// ── Cursor type mapping ───────────────────────────────────────────────────────

static const char* CursorTypeForHandle(HCURSOR hCursor) {
    if (!hCursor) return "default";

    struct { LPCTSTR id; const char* name; } kMap[] = {
        { IDC_ARROW,     "default"   },
        { IDC_IBEAM,     "text"      },
        { IDC_HAND,      "pointer"   },
        { IDC_CROSS,     "crosshair" },
        { IDC_SIZEALL,   "resize"    },
        { IDC_SIZENWSE,  "resize"    },
        { IDC_SIZENESW,  "resize"    },
        { IDC_SIZEWE,    "resize"    },
        { IDC_SIZENS,    "resize"    },
        { IDC_WAIT,      "default"   },
        { IDC_APPSTARTING, "default" },
        { IDC_NO,        "default"   },
        { IDC_HELP,      "default"   },
    };

    for (auto& entry : kMap) {
        HCURSOR known = LoadCursor(nullptr, entry.id);
        if (known && known == hCursor) {
            return entry.name;
        }
    }
    return "default";
}

// ── Timestamp helper ──────────────────────────────────────────────────────────

static int64_t NowMs() {
    FILETIME ft;
    GetSystemTimeAsFileTime(&ft);
    ULARGE_INTEGER uli;
    uli.LowPart  = ft.dwLowDateTime;
    uli.HighPart = ft.dwHighDateTime;
    // FILETIME epoch is 1601-01-01; Unix epoch offset is 116444736000000000 hns.
    return (int64_t)((uli.QuadPart - 116444736000000000ULL) / 10000ULL);
}

// Converts the low-level hook message timestamp to a Unix epoch millisecond timestamp.
//
// MSLLHOOKSTRUCT::time / KBDLLHOOKSTRUCT::time uses the same clock domain as
// GetTickCount(): milliseconds since system boot, stored as a 32-bit counter.
// Using NowMs() directly stamps the event at callback-processing time, which can
// drift noticeably under load and makes the overlay cursor appear late relative to
// the recorded screen. Instead, reconstruct the original event time by measuring
// how far the hook timestamp is behind the current tick count.
static int64_t HookMessageTimeToUnixMs(DWORD messageTime) {
    const DWORD nowTick = GetTickCount();
    const DWORD ageMs = nowTick - messageTime; // unsigned subtraction handles wrap
    return NowMs() - static_cast<int64_t>(ageMs);
}

// ── Key category / label ──────────────────────────────────────────────────────

static bool HasModifier(DWORD vkCode) {
    // Returns true if Ctrl, Alt, or Win is currently held.
    return (GetAsyncKeyState(VK_CONTROL) & 0x8000) ||
           (GetAsyncKeyState(VK_MENU)    & 0x8000) ||
           (GetAsyncKeyState(VK_LWIN)    & 0x8000) ||
           (GetAsyncKeyState(VK_RWIN)    & 0x8000);
}

static const char* KeyCategory(DWORD vk, bool withModifier) {
    switch (vk) {
        case VK_SHIFT: case VK_LSHIFT: case VK_RSHIFT:
        case VK_CONTROL: case VK_LCONTROL: case VK_RCONTROL:
        case VK_MENU: case VK_LMENU: case VK_RMENU:
        case VK_LWIN: case VK_RWIN: case VK_CAPITAL:
            return "modifier";

        case VK_RETURN: return withModifier ? "shortcut" : "enter";
        case VK_BACK:   return withModifier ? "shortcut" : "delete";
        case VK_DELETE: return withModifier ? "shortcut" : "delete";
        case VK_TAB:    return withModifier ? "shortcut" : "whitespace";
        case VK_SPACE:  return withModifier ? "shortcut" : "whitespace";

        case VK_LEFT: case VK_RIGHT: case VK_UP: case VK_DOWN:
        case VK_PRIOR: case VK_NEXT: case VK_HOME: case VK_END:
            return withModifier ? "shortcut" : "navigation";

        case VK_ESCAPE:
        case VK_F1: case VK_F2: case VK_F3: case VK_F4:
        case VK_F5: case VK_F6: case VK_F7: case VK_F8:
        case VK_F9: case VK_F10: case VK_F11: case VK_F12:
        case VK_F13: case VK_F14: case VK_F15: case VK_F16:
        case VK_F17: case VK_F18: case VK_F19: case VK_F20:
        case VK_F21: case VK_F22: case VK_F23: case VK_F24:
        case VK_VOLUME_UP: case VK_VOLUME_DOWN: case VK_VOLUME_MUTE:
            return "system";

        default:
            break;
    }
    // A-Z, 0-9, numpad, symbols
    if ((vk >= 'A' && vk <= 'Z') ||
        (vk >= '0' && vk <= '9') ||
        (vk >= VK_NUMPAD0 && vk <= VK_NUMPAD9) ||
        vk == VK_OEM_MINUS || vk == VK_OEM_PLUS || vk == VK_OEM_COMMA ||
        vk == VK_OEM_PERIOD || vk == VK_OEM_1 || vk == VK_OEM_2 ||
        vk == VK_OEM_3 || vk == VK_OEM_4 || vk == VK_OEM_5 ||
        vk == VK_OEM_6 || vk == VK_OEM_7) {
        return withModifier ? "shortcut" : "character";
    }
    return "unknown";
}

// Returns a key label string or nullptr if it should be omitted.
static const char* KeyLabel(DWORD vk) {
    switch (vk) {
        case VK_SHIFT: case VK_LSHIFT: case VK_RSHIFT:   return "Shift";
        case VK_CONTROL: case VK_LCONTROL: case VK_RCONTROL: return "Ctrl";
        case VK_MENU: case VK_LMENU: case VK_RMENU:      return "Alt";
        case VK_LWIN: case VK_RWIN:                       return "Meta";
        case VK_CAPITAL:                                  return "Caps Lock";
        case VK_RETURN:                                   return "Enter";
        case VK_BACK:                                     return "Backspace";
        case VK_DELETE:                                   return "Delete";
        case VK_TAB:                                      return "Tab";
        case VK_SPACE:                                    return "Space";
        case VK_ESCAPE:                                   return "Esc";
        case VK_LEFT:                                     return "Left";
        case VK_RIGHT:                                    return "Right";
        case VK_UP:                                       return "Up";
        case VK_DOWN:                                     return "Down";
        case VK_PRIOR:                                    return "Page Up";
        case VK_NEXT:                                     return "Page Down";
        case VK_HOME:                                     return "Home";
        case VK_END:                                      return "End";
        case VK_F1:  return "F1";  case VK_F2:  return "F2";
        case VK_F3:  return "F3";  case VK_F4:  return "F4";
        case VK_F5:  return "F5";  case VK_F6:  return "F6";
        case VK_F7:  return "F7";  case VK_F8:  return "F8";
        case VK_F9:  return "F9";  case VK_F10: return "F10";
        case VK_F11: return "F11"; case VK_F12: return "F12";
        case VK_VOLUME_UP:   return "Volume Up";
        case VK_VOLUME_DOWN: return "Volume Down";
        case VK_VOLUME_MUTE: return "Mute";
        default: break;
    }
    // Single-char labels for A-Z, 0-9.
    static char buf[2] = { 0, 0 };
    if (vk >= 'A' && vk <= 'Z') { buf[0] = (char)vk; return buf; }
    if (vk >= '0' && vk <= '9') { buf[0] = (char)vk; return buf; }
    return nullptr;
}

static bool ShouldEmitLabel(const char* category, bool withModifier) {
    return strcmp(category, "modifier")   == 0 ||
           strcmp(category, "shortcut")   == 0 ||
           strcmp(category, "navigation") == 0 ||
           strcmp(category, "system")     == 0 ||
           ((strcmp(category, "whitespace") == 0 ||
             strcmp(category, "enter")      == 0 ||
             strcmp(category, "delete")     == 0) && withModifier);
}

// ── JSON emission ─────────────────────────────────────────────────────────────

// Escape a string for JSON (only handles printable ASCII / common chars).
static void JsonEscapeAppend(char* buf, size_t& pos, size_t cap, const char* s) {
    for (; *s && pos + 2 < cap; ++s) {
        char c = *s;
        if (c == '"' || c == '\\') {
            buf[pos++] = '\\';
        }
        buf[pos++] = c;
    }
}

void EventMonitor::EmitEvent(const char* json) {
    printf("%s\n", json);
    fflush(stdout);
}

// ── Hook callbacks ────────────────────────────────────────────────────────────

LRESULT CALLBACK EventMonitor::MouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && s_instance && !s_instance->m_isPaused) {
        s_instance->HandleMouse(wParam,
            reinterpret_cast<MSLLHOOKSTRUCT*>(lParam));
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

LRESULT CALLBACK EventMonitor::KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && s_instance && !s_instance->m_isPaused) {
        s_instance->HandleKeyboard(wParam,
            reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam));
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

VOID CALLBACK EventMonitor::CursorTimerProc(HWND, UINT, UINT_PTR, DWORD) {
    if (s_instance && !s_instance->m_isPaused) {
        s_instance->PollCursor();
    }
}

void EventMonitor::HandleMouse(WPARAM wParam, MSLLHOOKSTRUCT* ms) {
    int64_t ts   = HookMessageTimeToUnixMs(ms->time);
    double  x    = ms->pt.x;
    double  y    = ms->pt.y;
    const char* ct = m_lastCursorType;

    char buf[256];
    switch (wParam) {
        case WM_MOUSEMOVE:
            m_moveCount++;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"move\",\"x\":%.1f,\"y\":%.1f,"
                "\"timestamp\":%" PRId64 ",\"cursorType\":\"%s\"}",
                x, y, ts, ct);
            EmitEvent(buf);
            break;

        case WM_LBUTTONDOWN:
            m_downCount++;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"mousedown\",\"x\":%.1f,\"y\":%.1f,"
                "\"timestamp\":%" PRId64 ",\"button\":\"left\",\"cursorType\":\"%s\"}",
                x, y, ts, ct);
            EmitEvent(buf);
            break;

        case WM_LBUTTONUP:
            m_upCount++;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"mouseup\",\"x\":%.1f,\"y\":%.1f,"
                "\"timestamp\":%" PRId64 ",\"button\":\"left\",\"cursorType\":\"%s\"}",
                x, y, ts, ct);
            EmitEvent(buf);
            break;

        case WM_RBUTTONDOWN:
            m_downCount++;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"mousedown\",\"x\":%.1f,\"y\":%.1f,"
                "\"timestamp\":%" PRId64 ",\"button\":\"right\",\"cursorType\":\"%s\"}",
                x, y, ts, ct);
            EmitEvent(buf);
            break;

        case WM_RBUTTONUP:
            m_upCount++;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"mouseup\",\"x\":%.1f,\"y\":%.1f,"
                "\"timestamp\":%" PRId64 ",\"button\":\"right\",\"cursorType\":\"%s\"}",
                x, y, ts, ct);
            EmitEvent(buf);
            break;

        case WM_MOUSEWHEEL: {
            m_scrollCount++;
            short delta = HIWORD(ms->mouseData);
            double dy = -(double)delta / WHEEL_DELTA;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"scroll\",\"x\":%.1f,\"y\":%.1f,"
                "\"deltaX\":0,\"deltaY\":%.2f,"
                "\"timestamp\":%" PRId64 ",\"cursorType\":\"%s\"}",
                x, y, dy, ts, ct);
            EmitEvent(buf);
            break;
        }

        case WM_MOUSEHWHEEL: {
            m_scrollCount++;
            short delta = HIWORD(ms->mouseData);
            double dx = (double)delta / WHEEL_DELTA;
            snprintf(buf, sizeof(buf),
                "{\"type\":\"scroll\",\"x\":%.1f,\"y\":%.1f,"
                "\"deltaX\":%.2f,\"deltaY\":0,"
                "\"timestamp\":%" PRId64 ",\"cursorType\":\"%s\"}",
                x, y, dx, ts, ct);
            EmitEvent(buf);
            break;
        }

        default: break;
    }
}

void EventMonitor::HandleKeyboard(WPARAM wParam, KBDLLHOOKSTRUCT* kb) {
    bool isDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
    bool isUp   = (wParam == WM_KEYUP   || wParam == WM_SYSKEYUP);
    if (!isDown && !isUp) return;

    DWORD vk = kb->vkCode;
    bool repeat = (kb->flags & LLKHF_INJECTED) == 0 && isDown &&
                  (GetAsyncKeyState(vk) & 0x8000);
    bool withMod = HasModifier(vk);
    const char* category = KeyCategory(vk, withMod);
    const char* label    = ShouldEmitLabel(category, withMod) ? KeyLabel(vk) : nullptr;

    bool meta  = (GetAsyncKeyState(VK_LWIN)    & 0x8000) ||
                 (GetAsyncKeyState(VK_RWIN)     & 0x8000);
    bool ctrl  = (GetAsyncKeyState(VK_CONTROL)  & 0x8000) != 0;
    bool alt   = (GetAsyncKeyState(VK_MENU)     & 0x8000) != 0;
    bool shift = (GetAsyncKeyState(VK_SHIFT)    & 0x8000) != 0;
    int64_t ts = HookMessageTimeToUnixMs(kb->time);

    if (isDown) m_keyDownCount++; else m_keyUpCount++;

    char buf[512];
    if (label) {
        // Escape label for JSON safety.
        char escaped[64] = {};
        size_t pos = 0;
        JsonEscapeAppend(escaped, pos, sizeof(escaped), label);
        escaped[pos] = '\0';

        snprintf(buf, sizeof(buf),
            "{\"type\":\"%s\",\"timestamp\":%" PRId64 ","
            "\"keyCategory\":\"%s\","
            "\"keyLabel\":\"%s\","
            "\"modifiers\":{\"meta\":%s,\"ctrl\":%s,\"alt\":%s,\"shift\":%s},"
            "\"repeat\":%s}",
            isDown ? "keydown" : "keyup", ts,
            category, escaped,
            meta ? "true" : "false", ctrl ? "true" : "false",
            alt  ? "true" : "false", shift ? "true" : "false",
            repeat ? "true" : "false");
    } else {
        snprintf(buf, sizeof(buf),
            "{\"type\":\"%s\",\"timestamp\":%" PRId64 ","
            "\"keyCategory\":\"%s\","
            "\"modifiers\":{\"meta\":%s,\"ctrl\":%s,\"alt\":%s,\"shift\":%s},"
            "\"repeat\":%s}",
            isDown ? "keydown" : "keyup", ts,
            category,
            meta ? "true" : "false", ctrl ? "true" : "false",
            alt  ? "true" : "false", shift ? "true" : "false",
            repeat ? "true" : "false");
    }
    EmitEvent(buf);
}

void EventMonitor::PollCursor() {
    CURSORINFO ci{};
    ci.cbSize = sizeof(ci);
    if (!GetCursorInfo(&ci)) return;

    HCURSOR hCursor = ci.hCursor;
    if (hCursor == m_lastCursor) return;

    m_lastCursor     = hCursor;
    m_lastCursorType = CursorTypeForHandle(hCursor);

    // Emit a move event so the renderer knows the cursor type changed.
    POINT pt = ci.ptScreenPos;
    int64_t ts = NowMs();
    char buf[256];
    snprintf(buf, sizeof(buf),
        "{\"type\":\"move\",\"x\":%.1f,\"y\":%.1f,"
        "\"timestamp\":%" PRId64 ",\"cursorType\":\"%s\"}",
        (double)pt.x, (double)pt.y, ts, m_lastCursorType);
    EmitEvent(buf);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

EventMonitor::EventMonitor() = default;

EventMonitor::~EventMonitor() {
    Stop();
}

void EventMonitor::Start() {
    s_instance = this;

    m_mouseHook    = SetWindowsHookEx(WH_MOUSE_LL,    MouseProc,    nullptr, 0);
    m_keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, nullptr, 0);

    if (!m_mouseHook || !m_keyboardHook) {
        fprintf(stderr, "[EventMonitor] hook install failed (error=%lu); "
                "cursor/click events may be missing\n", GetLastError());
    } else {
        fprintf(stderr, "[EventMonitor] hooks installed\n");
    }

    // Cursor polling at ~30 Hz.
    m_cursorTimer = SetTimer(nullptr, 0, 33, CursorTimerProc);
}

void EventMonitor::Stop() {
    if (m_cursorTimer) {
        KillTimer(nullptr, m_cursorTimer);
        m_cursorTimer = 0;
    }
    if (m_mouseHook) {
        UnhookWindowsHookEx(m_mouseHook);
        m_mouseHook = nullptr;
    }
    if (m_keyboardHook) {
        UnhookWindowsHookEx(m_keyboardHook);
        m_keyboardHook = nullptr;
    }

    fprintf(stderr,
        "[EventMonitor] summary: move=%" PRIu64 " down=%" PRIu64
        " up=%" PRIu64 " scroll=%" PRIu64
        " keydown=%" PRIu64 " keyup=%" PRIu64 "\n",
        m_moveCount, m_downCount, m_upCount,
        m_scrollCount, m_keyDownCount, m_keyUpCount);

    s_instance = nullptr;
}

void EventMonitor::Pause()  { m_isPaused = true;  }
void EventMonitor::Resume() { m_isPaused = false; }
