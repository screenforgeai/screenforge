// main.cpp — ScreenforgeCapture for Windows
// Entry point: parses CLI args, drives CaptureEngine + EventMonitor.
// IPC: stdout = newline-delimited JSON events
//      stderr = diagnostics + "Recording started\n" ready signal
//      stdin  = "pause\n" / "resume\n" / "stop\n" commands
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <mfapi.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>

#include <string>
#include <string_view>
#include <vector>
#include <thread>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <sstream>

#include "CaptureEngine.h"
#include "EventMonitor.h"

// ── Globals ────────────────────────────────────────────────────────────────────
static std::atomic<bool> g_stopping{ false };
static CaptureEngine*    g_engine  = nullptr;
static EventMonitor*     g_monitor = nullptr;

// ── Console ctrl handler ───────────────────────────────────────────────────────
static BOOL WINAPI CtrlHandler(DWORD type) {
    switch (type) {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
        case CTRL_CLOSE_EVENT:
        case CTRL_LOGOFF_EVENT:
        case CTRL_SHUTDOWN_EVENT:
            g_stopping = true;
            return TRUE;
        default:
            return FALSE;
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
static std::string WideToUtf8(const std::wstring& w) {
    if (w.empty()) return {};
    int sz = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string s(sz - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &s[0], sz, nullptr, nullptr);
    return s;
}

static std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return {};
    int sz = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(sz - 1, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], sz);
    return w;
}

// Simple JSON string escape — only covers the chars we emit in window titles/app names.
static std::string JsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 4);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out;
}

// ── Window listing ─────────────────────────────────────────────────────────────
struct WindowInfo {
    HWND        hwnd;
    std::string appName;
    std::string title;
    int         x, y, width, height;
    float       scaleFactor;
};

static BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    auto* list = reinterpret_cast<std::vector<WindowInfo>*>(lParam);

    if (!IsWindowVisible(hwnd)) return TRUE;
    if (IsIconic(hwnd))         return TRUE;

    // Skip windows without a title
    wchar_t title[512] = {};
    GetWindowTextW(hwnd, title, 512);
    if (title[0] == L'\0') return TRUE;

    // Get owning process name as app name
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    std::string appName;
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (hProc) {
        wchar_t exePath[MAX_PATH] = {};
        DWORD sz = MAX_PATH;
        if (QueryFullProcessImageNameW(hProc, 0, exePath, &sz)) {
            // Basename only
            std::wstring path(exePath);
            size_t slash = path.rfind(L'\\');
            if (slash != std::wstring::npos) path = path.substr(slash + 1);
            // Strip .exe
            if (path.size() > 4 &&
                _wcsicmp(path.c_str() + path.size() - 4, L".exe") == 0) {
                path.resize(path.size() - 4);
            }
            appName = WideToUtf8(path);
        }
        CloseHandle(hProc);
    }
    if (appName.empty()) appName = "Unknown";

    RECT rc = {};
    GetWindowRect(hwnd, &rc);

    // DPI scale factor
    UINT dpi = GetDpiForWindow(hwnd);
    float scale = (dpi > 0) ? static_cast<float>(dpi) / 96.0f : 1.0f;

    WindowInfo wi;
    wi.hwnd        = hwnd;
    wi.appName     = appName;
    wi.title       = WideToUtf8(title);
    wi.x           = rc.left;
    wi.y           = rc.top;
    wi.width       = rc.right  - rc.left;
    wi.height      = rc.bottom - rc.top;
    wi.scaleFactor = scale;

    if (wi.width > 0 && wi.height > 0) {
        list->push_back(std::move(wi));
    }
    return TRUE;
}

static void ListWindows() {
    std::vector<WindowInfo> windows;
    EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&windows));

    std::string json = "{\"windows\":{";
    bool first = true;
    for (auto& w : windows) {
        if (!first) json += ',';
        first = false;
        // Key is the HWND as a decimal string (matches windowId field)
        uint64_t id = reinterpret_cast<uint64_t>(w.hwnd);
        char buf[512];
        snprintf(buf, sizeof(buf),
            "\"%llu\":{\"windowID\":%llu,\"appName\":\"%s\",\"windowTitle\":\"%s\","
            "\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"scaleFactor\":%.2f}",
            (unsigned long long)id,
            (unsigned long long)id,
            JsonEscape(w.appName).c_str(),
            JsonEscape(w.title).c_str(),
            w.x, w.y, w.width, w.height,
            (double)w.scaleFactor);
        json += buf;
    }
    json += "}}";

    // Emit as stdout JSON event (same channel as event stream)
    puts(json.c_str());
    fflush(stdout);
}

// ── Screen capture permission (always granted on Windows) ─────────────────────
static void CheckScreenAccess() {
    // WGC doesn't require explicit permission on Windows — always "granted".
    puts("{\"status\":\"granted\"}");
    fflush(stdout);
}

static void RequestScreenAccess() {
    puts("{\"status\":\"granted\"}");
    fflush(stdout);
}

// ── Stdin reader thread ────────────────────────────────────────────────────────
static void StdinReaderThread() {
    char line[256];
    while (!g_stopping) {
        if (!fgets(line, sizeof(line), stdin)) {
            // EOF — parent process closed the pipe, time to stop.
            fprintf(stderr, "[CaptureEngine] stdin EOF — stopping\n");
            g_stopping = true;
            break;
        }
        std::string_view cmd(line);
        // Trim trailing whitespace
        while (!cmd.empty() && (cmd.back() == '\n' || cmd.back() == '\r' || cmd.back() == ' '))
            cmd.remove_suffix(1);

        if (cmd == "pause") {
            if (g_engine)  g_engine->Pause();
            if (g_monitor) g_monitor->Pause();
        } else if (cmd == "resume") {
            if (g_engine)  g_engine->Resume();
            if (g_monitor) g_monitor->Resume();
        } else if (cmd == "stop") {
            fprintf(stderr, "[CaptureEngine] stop command received\n");
            g_stopping = true;
            break;
        }
    }
}

// ── Arg parsing ───────────────────────────────────────────────────────────────
struct Args {
    bool        listWindows        = false;
    bool        checkScreenAccess  = false;
    bool        requestScreenAccess = false;
    std::string outputPath;
    int         fps              = 60;
    int         displayIndex     = 0;
    UINT32      displayId        = 0;
    bool        hasDisplayId     = false;
    UINT64      windowId         = 0;
    bool        hasWindowId      = false;
    std::wstring excludeTitle;
};

static Args ParseArgs(int argc, wchar_t* argv[]) {
    Args a;
    for (int i = 1; i < argc; ++i) {
        std::wstring arg(argv[i]);
        auto next = [&]() -> std::wstring {
            return (i + 1 < argc) ? std::wstring(argv[++i]) : L"";
        };

        if (arg == L"--list-windows") {
            a.listWindows = true;
        } else if (arg == L"--check-screen-access") {
            a.checkScreenAccess = true;
        } else if (arg == L"--request-screen-access") {
            a.requestScreenAccess = true;
        } else if (arg == L"--output") {
            a.outputPath = WideToUtf8(next());
        } else if (arg == L"--fps") {
            a.fps = std::stoi(WideToUtf8(next()));
        } else if (arg == L"--display") {
            a.displayIndex = std::stoi(WideToUtf8(next()));
        } else if (arg == L"--display-id") {
            a.displayId    = static_cast<UINT32>(std::stoul(WideToUtf8(next())));
            a.hasDisplayId = true;
        } else if (arg == L"--window-id") {
            a.windowId    = std::stoull(WideToUtf8(next()));
            a.hasWindowId = true;
        } else if (arg == L"--exclude-window-title") {
            a.excludeTitle = next();
        }
    }
    return a;
}

// ── main ──────────────────────────────────────────────────────────────────────
int wmain(int argc, wchar_t* argv[]) {
    // Disable stdout/stderr buffering so the parent process sees events promptly.
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

    // COM / WinRT initialisation (MTA required for WGC + MF on the capture thread).
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    // Media Foundation must be started before any MF sink/source functions.
    HRESULT hrMF = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
    if (FAILED(hrMF)) {
        fprintf(stderr, "ScreenforgeCapture: MFStartup failed: 0x%08lX\n", hrMF);
        return 1;
    }

    SetConsoleCtrlHandler(CtrlHandler, TRUE);

    Args args = ParseArgs(argc, argv);

    // One-shot commands — execute and exit.
    if (args.listWindows) {
        ListWindows();
        return 0;
    }
    if (args.checkScreenAccess) {
        CheckScreenAccess();
        return 0;
    }
    if (args.requestScreenAccess) {
        RequestScreenAccess();
        return 0;
    }

    if (args.outputPath.empty()) {
        fprintf(stderr, "ScreenforgeCapture: --output is required\n");
        return 1;
    }

    // Build config
    CaptureConfig cfg;
    cfg.displayIndex  = args.displayIndex;
    cfg.displayId     = args.displayId;
    cfg.hasDisplayId  = args.hasDisplayId;
    cfg.windowId      = args.windowId;
    cfg.hasWindowId   = args.hasWindowId;
    cfg.excludeTitle  = args.excludeTitle;
    cfg.outputPath    = Utf8ToWide(args.outputPath);
    cfg.fps           = args.fps;

    // Scope engine and monitor so their destructors (which release COM/WinRT
    // objects) run BEFORE MFShutdown / CoUninitialize. Releasing COM objects
    // after COM teardown causes STATUS_ACCESS_VIOLATION (0xC0000005).
    {
        CaptureEngine engine(cfg);
        EventMonitor  monitor;
        g_engine  = &engine;
        g_monitor = &monitor;

        // Start event monitor first (no dependencies)
        monitor.Start();

        // Stdin reader thread — handles pause/resume and EOF-triggered shutdown.
        std::thread stdinThread(StdinReaderThread);
        stdinThread.detach();

        // Start capture — completion callback fires from WGC thread.
        engine.Start([&](bool ok) {
            if (!ok) {
                fprintf(stderr, "ScreenforgeCapture: capture failed to start\n");
                g_stopping = true;
            }
        });

        // Spin the message loop — WGC frame callbacks and SetTimer fire here.
        MSG msg;
        while (!g_stopping) {
            while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            // Yield to avoid burning a core when the message queue is empty.
            MsgWaitForMultipleObjectsEx(0, nullptr, 10, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }

        // Graceful stop
        monitor.Stop();
        g_monitor = nullptr;

        bool stopped = false;
        engine.Stop([&]() { stopped = true; });

        // Process messages until Stop's completion fires (it runs on this thread).
        while (!stopped) {
            while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            MsgWaitForMultipleObjectsEx(0, nullptr, 10, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }

        g_engine = nullptr;
    } // engine + monitor destructors run here — COM still alive

    MFShutdown();
    CoUninitialize();
    winrt::uninit_apartment();
    return 0;
}
