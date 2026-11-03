#pragma once
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <codecapi.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <avrt.h>
#include <ksmedia.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <functional>
#include <thread>
#include <atomic>
#include <mutex>
#include <string>
#include <cstdint>
#include <vector>

struct CaptureConfig {
    int         displayIndex   = 0;
    UINT32      displayId      = 0;
    bool        hasDisplayId   = false;
    UINT64      windowId       = 0;
    bool        hasWindowId    = false;
    std::wstring excludeTitle;
    std::wstring outputPath;
    int         fps            = 60;
};

class CaptureEngine {
public:
    explicit CaptureEngine(const CaptureConfig& cfg);
    ~CaptureEngine();

    // Starts capture. Calls completion(true) on success, completion(false) on
    // error (with a descriptive message already printed to stderr).
    void Start(std::function<void(bool)> completion);

    // Stops capture, finalises the MP4 file, calls completion when done.
    void Stop(std::function<void()> completion);

    void Pause();
    void Resume();

private:
    // ── D3D / WGC ─────────────────────────────────────────────────────────────
    HRESULT InitD3D();
    HRESULT BuildCaptureItem(
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem& itemOut);
    HRESULT SetupFramePool(
        const winrt::Windows::Graphics::Capture::GraphicsCaptureItem& item);
    void    OnFrameArrived(
        winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const&,
        winrt::Windows::Foundation::IInspectable const&);

    // ── Media Foundation ──────────────────────────────────────────────────────
    HRESULT InitSinkWriter(UINT32 width, UINT32 height);
    void    WriteVideoFrame(ID3D11Texture2D* pTex, LONGLONG pts, LONGLONG dur);

    // ── WASAPI loopback ───────────────────────────────────────────────────────
    HRESULT InitAudio();
    void    AudioCaptureLoop();

    // ── Timing helpers ────────────────────────────────────────────────────────
    LONGLONG NowHns() const;   // current time in 100-ns units relative to session start

    // ── Fields ────────────────────────────────────────────────────────────────
    CaptureConfig m_cfg;

    // D3D
    winrt::com_ptr<ID3D11Device>        m_d3dDevice;
    winrt::com_ptr<ID3D11DeviceContext> m_d3dCtx;
    std::vector<winrt::com_ptr<ID3D11Texture2D>> m_copyTexPool;
    std::size_t                         m_copyTexIndex = 0;

    // WGC
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem      m_item{ nullptr };
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool m_framePool{ nullptr };
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession    m_session{ nullptr };
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice m_winrtDevice{ nullptr };
    winrt::event_token                  m_frameToken{};

    // MF
    winrt::com_ptr<IMFSinkWriter>       m_sinkWriter;
    winrt::com_ptr<IMFDXGIDeviceManager> m_dxgiMgr;
    DWORD  m_videoStream = 0;
    DWORD  m_audioStream = 0;
    UINT32 m_captureW    = 0;
    UINT32 m_captureH    = 0;

    // WASAPI
    winrt::com_ptr<IAudioClient>        m_audioClient;
    winrt::com_ptr<IAudioCaptureClient> m_captureClient;
    std::thread                         m_audioThread;
    std::thread                         m_initThread;   // background MF init
    std::atomic<bool>                   m_audioRunning{ false };
    WAVEFORMATEX*                       m_pAudioFormat = nullptr;

    // Timing / pause
    LARGE_INTEGER m_perfFreq{};
    LARGE_INTEGER m_sessionStart{};
    LONGLONG      m_pauseOffset   = 0;    // accumulated paused time (100-ns)
    LONGLONG      m_pauseStart    = 0;
    std::atomic<bool> m_isPaused{ false };
    std::atomic<bool> m_sinkWriterReady{ false };
    std::atomic<bool> m_hasAudioStream{ false };

    // State
    std::atomic<bool> m_sessionStarted{ false };
    std::atomic<bool> m_stopping{ false };
    std::uint64_t     m_framesWritten       = 0;
    std::uint64_t     m_audioSamplesWritten = 0;  // for sample-count-based audio PTS
    std::mutex        m_mfMutex;          // serialise MF writes (video + audio)

    std::function<void()> m_stopCompletion;
};
