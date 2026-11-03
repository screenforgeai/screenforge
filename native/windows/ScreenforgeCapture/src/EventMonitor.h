#pragma once
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <atomic>
#include <cstdint>

class EventMonitor {
public:
    EventMonitor();
    ~EventMonitor();

    void Start();
    void Stop();
    void Pause();
    void Resume();

private:
    static LRESULT CALLBACK MouseProc(int nCode, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam);
    static VOID   CALLBACK CursorTimerProc(HWND, UINT, UINT_PTR, DWORD);

    void HandleMouse(WPARAM wParam, MSLLHOOKSTRUCT* ms);
    void HandleKeyboard(WPARAM wParam, KBDLLHOOKSTRUCT* kb);
    void PollCursor();
    void EmitEvent(const char* json);

    HHOOK m_mouseHook    = nullptr;
    HHOOK m_keyboardHook = nullptr;
    UINT_PTR m_cursorTimer = 0;

    std::atomic<bool> m_isPaused{ false };

    // Cursor state
    HCURSOR m_lastCursor  = nullptr;
    const char* m_lastCursorType = "default";

    // Statistics
    uint64_t m_moveCount   = 0;
    uint64_t m_downCount   = 0;
    uint64_t m_upCount     = 0;
    uint64_t m_scrollCount = 0;
    uint64_t m_keyDownCount = 0;
    uint64_t m_keyUpCount  = 0;

    // Thread-local pointer for static hook callbacks.
    static EventMonitor* s_instance;
};
