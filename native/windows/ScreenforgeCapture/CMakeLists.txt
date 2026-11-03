cmake_minimum_required(VERSION 3.20)
project(ScreenforgeCapture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Windows SDK version (min Win10 1803 for WGC) ──────────────────────────────
if(NOT CMAKE_SYSTEM_VERSION)
  set(CMAKE_SYSTEM_VERSION "10.0.19041.0")
endif()

add_executable(ScreenforgeCapture
    src/main.cpp
    src/CaptureEngine.cpp
    src/EventMonitor.cpp
)

# ── C++/WinRT headers ─────────────────────────────────────────────────────────
# The Windows SDK ships C++/WinRT projections under Include\<sdk>\cppwinrt.
# CMake's find_package doesn't cover this; we set it via compile options.
target_compile_options(ScreenforgeCapture PRIVATE
    /W3
    /WX-
    /permissive-
    /DUNICODE
    /D_UNICODE
    /DWINVER=0x0A00
    /D_WIN32_WINNT=0x0A00
    /DNTDDI_VERSION=0x0A000005  # Win10 1803
    /utf-8
)

target_link_libraries(ScreenforgeCapture PRIVATE
    d3d11.lib
    dxgi.lib
    mf.lib
    mfuuid.lib
    mfplat.lib
    mfreadwrite.lib
    ole32.lib
    oleaut32.lib
    runtimeobject.lib   # WinRT activation
    avrt.lib            # MMCSS (audio thread priority)
    ksuser.lib
    windowsapp.lib
)

# ── Static CRT (no VC++ Redist dependency) ────────────────────────────────────
set_property(TARGET ScreenforgeCapture PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# ── Output directly into native/bin/win32-x64 ─────────────────────────────────
set_target_properties(ScreenforgeCapture PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY_RELEASE
        "${CMAKE_SOURCE_DIR}/../../bin/win32-x64"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG
        "${CMAKE_SOURCE_DIR}/../../bin/win32-x64"
)
