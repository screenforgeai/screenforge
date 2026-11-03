#include "CaptureEngine.h"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <mfobjects.h>
#include <stdexcept>
#include <thread>

// IDirect3DDxgiInterfaceAccess is the correct interop path for WGC surfaces.
// Declared inline to avoid SDK include-path dependencies.
struct __declspec(uuid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"))
IDirect3DDxgiInterfaceAccess : IUnknown {
    virtual HRESULT STDMETHODCALLTYPE GetInterface(REFIID iid, void** p) = 0;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

static void LogFmt(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    vfprintf(stderr, fmt, args);
    va_end(args);
    fflush(stderr);
}

static HRESULT SetAttribute(IMFAttributes* pAttr, REFGUID key, UINT32 value) {
    return pAttr->SetUINT32(key, value);
}

// Compute bitrate matching macOS: 0.07 bpp/frame, 20–100 Mbps range.
static UINT32 ComputeBitrate(UINT32 w, UINT32 h, int fps) {
    double bps = (double)w * h * fps * 0.07;
    bps = std::max(bps, 20'000'000.0);
    bps = std::min(bps, 100'000'000.0);
    return static_cast<UINT32>(bps);
}

static UINT32 ComputeAudioBitrateBytesPerSecond(UINT32 channels) {
    return std::clamp<UINT32>(channels * 12'000, 12'000, 96'000);
}

constexpr std::size_t kCopyTexturePoolSize = 8;

static const WAVEFORMATEXTENSIBLE* AsExtensible(const WAVEFORMATEX* format) {
    if (!format || format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
        return nullptr;
    }

    if (format->cbSize < sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
        return nullptr;
    }

    return reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
}

static GUID AudioSubtypeForWaveFormat(const WAVEFORMATEX* format) {
    if (!format) return GUID_NULL;

    if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
        return MFAudioFormat_Float;
    }

    if (format->wFormatTag == WAVE_FORMAT_PCM) {
        return MFAudioFormat_PCM;
    }

    const WAVEFORMATEXTENSIBLE* extensible = AsExtensible(format);
    if (!extensible) {
        return GUID_NULL;
    }

    if (IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
        return MFAudioFormat_Float;
    }

    if (IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_PCM)) {
        return MFAudioFormat_PCM;
    }

    return GUID_NULL;
}

static UINT32 AudioChannelMaskForWaveFormat(const WAVEFORMATEX* format) {
    const WAVEFORMATEXTENSIBLE* extensible = AsExtensible(format);
    if (extensible && extensible->dwChannelMask != 0) {
        return extensible->dwChannelMask;
    }

    if (!format) return 0;
    if (format->nChannels == 1) return SPEAKER_FRONT_CENTER;
    if (format->nChannels == 2) return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    return 0;
}

static HRESULT SetDxgiBufferCurrentLength(IMFMediaBuffer* pBuf) {
    winrt::com_ptr<IMF2DBuffer> p2DBuffer;
    HRESULT hr = pBuf->QueryInterface(IID_PPV_ARGS(p2DBuffer.put()));
    if (SUCCEEDED(hr)) {
        DWORD contiguousLength = 0;
        hr = p2DBuffer->GetContiguousLength(&contiguousLength);
        if (SUCCEEDED(hr)) {
            return pBuf->SetCurrentLength(contiguousLength);
        }
    }

    DWORD maxLength = 0;
    hr = pBuf->GetMaxLength(&maxLength);
    if (SUCCEEDED(hr) && maxLength > 0) {
        return pBuf->SetCurrentLength(maxLength);
    }

    return hr;
}

static HRESULT WaitForGpuWork(ID3D11Device* device, ID3D11DeviceContext* ctx) {
    D3D11_QUERY_DESC queryDesc{};
    queryDesc.Query = D3D11_QUERY_EVENT;

    winrt::com_ptr<ID3D11Query> query;
    HRESULT hr = device->CreateQuery(&queryDesc, query.put());
    if (FAILED(hr)) return hr;

    ctx->End(query.get());
    ctx->Flush();

    while ((hr = ctx->GetData(query.get(), nullptr, 0, 0)) == S_FALSE) {
        Sleep(0);
    }

    return hr;
}

// Convert a D3D11 texture to a winrt IDirect3DSurface for WinRT interop.
static winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice
CreateWinRTDevice(ID3D11Device* pDevice) {
    winrt::com_ptr<IDXGIDevice> dxgiDevice;
    winrt::check_hresult(pDevice->QueryInterface(IID_PPV_ARGS(dxgiDevice.put())));
    winrt::com_ptr<IInspectable> inspectable;
    winrt::check_hresult(
        CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
    return inspectable.as<
        winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
}

static winrt::com_ptr<ID3D11Texture2D>
GetTextureFromSurface(
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DSurface const& surface) {
    // IDirect3DDxgiInterfaceAccess is the correct interop path for WGC surfaces.
    auto access = surface.as<IDirect3DDxgiInterfaceAccess>();
    winrt::com_ptr<ID3D11Texture2D> tex;
    winrt::check_hresult(access->GetInterface(IID_PPV_ARGS(tex.put())));
    return tex;
}

// ── Constructor / Destructor ──────────────────────────────────────────────────

CaptureEngine::CaptureEngine(const CaptureConfig& cfg) : m_cfg(cfg) {
    QueryPerformanceFrequency(&m_perfFreq);
}

CaptureEngine::~CaptureEngine() {
    if (m_audioRunning) {
        m_audioRunning = false;
        if (m_audioThread.joinable()) m_audioThread.join();
    }
    if (m_pAudioFormat) {
        CoTaskMemFree(m_pAudioFormat);
        m_pAudioFormat = nullptr;
    }
}

// ── Timing ────────────────────────────────────────────────────────────────────

LONGLONG CaptureEngine::NowHns() const {
    LARGE_INTEGER now;
    QueryPerformanceCounter(&now);
    LONGLONG elapsed = now.QuadPart - m_sessionStart.QuadPart;
    // Convert from perf ticks to 100-ns units, subtract accumulated pause time.
    return (LONGLONG)((double)elapsed / m_perfFreq.QuadPart * 10'000'000.0)
           - m_pauseOffset;
}

// ── D3D init ──────────────────────────────────────────────────────────────────

HRESULT CaptureEngine::InitD3D() {
    D3D_FEATURE_LEVEL featureLevel;
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    HRESULT hr = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags,
        nullptr, 0, D3D11_SDK_VERSION,
        m_d3dDevice.put(), &featureLevel, m_d3dCtx.put());
    if (FAILED(hr)) {
        LogFmt("[CaptureEngine] D3D11CreateDevice failed: 0x%08lX\n", hr);
        return hr;
    }

    m_winrtDevice = CreateWinRTDevice(m_d3dDevice.get());

    // DXGI device manager for hardware MF encoding.
    UINT resetToken = 0;
    hr = MFCreateDXGIDeviceManager(&resetToken, m_dxgiMgr.put());
    if (FAILED(hr)) return hr;
    hr = m_dxgiMgr->ResetDevice(m_d3dDevice.get(), resetToken);
    return hr;
}

// ── WGC capture item ──────────────────────────────────────────────────────────

HRESULT CaptureEngine::BuildCaptureItem(
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem& itemOut) {

    auto interop = winrt::get_activation_factory<
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem,
        IGraphicsCaptureItemInterop>();

    if (m_cfg.hasWindowId) {
        HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(m_cfg.windowId));
        try {
            winrt::check_hresult(interop->CreateForWindow(
                hwnd,
                winrt::guid_of<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>(),
                winrt::put_abi(itemOut)));
        } catch (winrt::hresult_error const& e) {
            LogFmt("[CaptureEngine] CreateForWindow failed: 0x%08lX\n",
                   static_cast<HRESULT>(e.code()));
            return static_cast<HRESULT>(e.code());
        }
        return S_OK;
    }

    // Display capture: enumerate monitors, pick by index or ID.
    struct MonitorEnum {
        int        targetIndex = 0;
        UINT32     targetId    = 0;
        bool       hasId       = false;
        int        current     = 0;
        HMONITOR   found       = nullptr;
    } ctx;
    ctx.targetIndex = m_cfg.displayIndex;
    ctx.targetId    = m_cfg.displayId;
    ctx.hasId       = m_cfg.hasDisplayId;

    EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR hmon, HDC, LPRECT, LPARAM lp) -> BOOL {
        auto* e = reinterpret_cast<MonitorEnum*>(lp);
        if (e->hasId) {
            MONITORINFOEX mi{};
            mi.cbSize = sizeof(mi);
            GetMonitorInfo(hmon, &mi);
            DISPLAY_DEVICE dd{};
            dd.cb = sizeof(dd);
            // Match by index as fallback — WGC display ID matching is not directly
            // available through EnumDisplayMonitors; use index ordering instead.
        }
        if (e->current == e->targetIndex) {
            e->found = hmon;
            return FALSE; // stop
        }
        e->current++;
        return TRUE;
    }, reinterpret_cast<LPARAM>(&ctx));

    if (!ctx.found) {
        // Fall back to primary monitor.
        ctx.found = MonitorFromPoint({ 0, 0 }, MONITOR_DEFAULTTOPRIMARY);
    }

    try {
        winrt::check_hresult(interop->CreateForMonitor(
            ctx.found,
            winrt::guid_of<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>(),
            winrt::put_abi(itemOut)));
    } catch (winrt::hresult_error const& e) {
        LogFmt("[CaptureEngine] CreateForMonitor failed: 0x%08lX\n",
               static_cast<HRESULT>(e.code()));
        return static_cast<HRESULT>(e.code());
    }
    return S_OK;
}

// ── Frame pool setup ──────────────────────────────────────────────────────────

HRESULT CaptureEngine::SetupFramePool(
    const winrt::Windows::Graphics::Capture::GraphicsCaptureItem& item) {

    auto size = item.Size();
    m_captureW = static_cast<UINT32>(size.Width);
    m_captureH = static_cast<UINT32>(size.Height);

    // Ensure even dimensions for H.264.
    m_captureW &= ~1u;
    m_captureH &= ~1u;
    if (m_captureW < 2) m_captureW = 2;
    if (m_captureH < 2) m_captureH = 2;

    LogFmt("[CaptureEngine] capture size: %ux%u at %d fps, bitrate=%.1f Mbps\n",
           m_captureW, m_captureH, m_cfg.fps,
           ComputeBitrate(m_captureW, m_captureH, m_cfg.fps) / 1'000'000.0);

    D3D11_TEXTURE2D_DESC td{};
    td.Width            = m_captureW;
    td.Height           = m_captureH;
    td.MipLevels        = 1;
    td.ArraySize        = 1;
    td.Format           = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc       = { 1, 0 };
    td.Usage            = D3D11_USAGE_DEFAULT;
    td.BindFlags        = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    td.MiscFlags        = D3D11_RESOURCE_MISC_SHARED;

    m_copyTexPool.clear();
    m_copyTexPool.reserve(kCopyTexturePoolSize);
    for (std::size_t i = 0; i < kCopyTexturePoolSize; ++i) {
        winrt::com_ptr<ID3D11Texture2D> tex;
        HRESULT hr = m_d3dDevice->CreateTexture2D(&td, nullptr, tex.put());
        if (FAILED(hr)) {
            LogFmt("[CaptureEngine] CreateTexture2D(pool[%zu]) failed: 0x%08lX\n", i, hr);
            return hr;
        }
        m_copyTexPool.push_back(std::move(tex));
    }
    m_copyTexIndex = 0;

    m_framePool = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::Create(
        m_winrtDevice,
        winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size);

    m_frameToken = m_framePool.FrameArrived(
        { this, &CaptureEngine::OnFrameArrived });

    m_session = m_framePool.CreateCaptureSession(item);
    m_session.IsCursorCaptureEnabled(false);

    // Suppress the yellow capture indicator border (Windows 11 build 20348+).
    try {
        m_session.IsBorderRequired(false);
    } catch (...) {}

    return S_OK;
}

// ── MF sink writer ────────────────────────────────────────────────────────────

HRESULT CaptureEngine::InitSinkWriter(UINT32 w, UINT32 h) {
    // Attributes: enable hardware encoding via DXGI device manager.
    winrt::com_ptr<IMFAttributes> pAttr;
    HRESULT hr = MFCreateAttributes(pAttr.put(), 4);
    if (FAILED(hr)) return hr;
    pAttr->SetUnknown(MF_SINK_WRITER_D3D_MANAGER, m_dxgiMgr.get());
    pAttr->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
    // Disable WriteSample back-pressure so the WGC callback thread never blocks.
    // Without this, a slow encoder stalls OnFrameArrived and causes WGC to drop frames.
    // The Finalize timeout below handles the resulting queue drain time.
    pAttr->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);

    hr = MFCreateSinkWriterFromURL(
        m_cfg.outputPath.c_str(), nullptr, pAttr.get(), m_sinkWriter.put());
    if (FAILED(hr)) {
        LogFmt("[CaptureEngine] MFCreateSinkWriterFromURL failed: 0x%08lX\n", hr);
        return hr;
    }

    // ── Video stream ─────────────────────────────────────────────────────────
    winrt::com_ptr<IMFMediaType> pVideoOut;
    MFCreateMediaType(pVideoOut.put());
    pVideoOut->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    pVideoOut->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    MFSetAttributeSize(pVideoOut.get(), MF_MT_FRAME_SIZE, w, h);
    MFSetAttributeRatio(pVideoOut.get(), MF_MT_FRAME_RATE, m_cfg.fps, 1);
    MFSetAttributeRatio(pVideoOut.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    pVideoOut->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    pVideoOut->SetUINT32(MF_MT_AVG_BITRATE, ComputeBitrate(w, h, m_cfg.fps));
    pVideoOut->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High);

    hr = m_sinkWriter->AddStream(pVideoOut.get(), &m_videoStream);
    if (FAILED(hr)) {
        LogFmt("[CaptureEngine] AddStream (video) failed: 0x%08lX\n", hr);
        return hr;
    }

    // Input type: BGRA (what WGC produces).
    winrt::com_ptr<IMFMediaType> pVideoIn;
    MFCreateMediaType(pVideoIn.put());
    pVideoIn->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    pVideoIn->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
    MFSetAttributeSize(pVideoIn.get(), MF_MT_FRAME_SIZE, w, h);
    MFSetAttributeRatio(pVideoIn.get(), MF_MT_FRAME_RATE, m_cfg.fps, 1);
    MFSetAttributeRatio(pVideoIn.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    pVideoIn->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

    hr = m_sinkWriter->SetInputMediaType(m_videoStream, pVideoIn.get(), nullptr);
    if (FAILED(hr)) {
        LogFmt("[CaptureEngine] SetInputMediaType (video) failed: 0x%08lX\n", hr);
        return hr;
    }

    // ── Audio stream ─────────────────────────────────────────────────────────
    if (m_pAudioFormat) {
        GUID audioInputSubtype = AudioSubtypeForWaveFormat(m_pAudioFormat);
        if (IsEqualGUID(audioInputSubtype, GUID_NULL)) {
            LogFmt("[CaptureEngine] unsupported WASAPI mix format tag=0x%04X; recording without system audio\n",
                   m_pAudioFormat->wFormatTag);
        } else {
            const UINT32 audioRate = m_pAudioFormat->nSamplesPerSec;
            const UINT32 audioChannels = m_pAudioFormat->nChannels;
            const UINT32 channelMask = AudioChannelMaskForWaveFormat(m_pAudioFormat);
            const UINT32 audioBitrateBytes = ComputeAudioBitrateBytesPerSecond(audioChannels);

            winrt::com_ptr<IMFMediaType> pAudioOut;
            MFCreateMediaType(pAudioOut.put());
            pAudioOut->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
            pAudioOut->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
            pAudioOut->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
            pAudioOut->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, audioRate);
            pAudioOut->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, audioChannels);
            pAudioOut->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, audioBitrateBytes);
            pAudioOut->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0);
            if (channelMask != 0) {
                pAudioOut->SetUINT32(MF_MT_AUDIO_CHANNEL_MASK, channelMask);
            }

            hr = m_sinkWriter->AddStream(pAudioOut.get(), &m_audioStream);
            if (FAILED(hr)) {
                LogFmt("[CaptureEngine] AddStream (audio) failed: 0x%08lX\n", hr);
                return hr;
            }

            winrt::com_ptr<IMFMediaType> pAudioIn;
            MFCreateMediaType(pAudioIn.put());
            pAudioIn->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
            pAudioIn->SetGUID(MF_MT_SUBTYPE, audioInputSubtype);
            pAudioIn->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, m_pAudioFormat->wBitsPerSample);
            pAudioIn->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, audioRate);
            pAudioIn->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, audioChannels);
            pAudioIn->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, m_pAudioFormat->nBlockAlign);
            pAudioIn->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, m_pAudioFormat->nAvgBytesPerSec);
            if (channelMask != 0) {
                pAudioIn->SetUINT32(MF_MT_AUDIO_CHANNEL_MASK, channelMask);
            }

            hr = m_sinkWriter->SetInputMediaType(m_audioStream, pAudioIn.get(), nullptr);
            if (FAILED(hr)) {
                LogFmt("[CaptureEngine] SetInputMediaType (audio) failed: 0x%08lX\n", hr);
                return hr;
            }

            m_hasAudioStream.store(true, std::memory_order_release);
            LogFmt("[CaptureEngine] audio stream: %u Hz, %u channels, %u bits, block=%u\n",
                   audioRate,
                   audioChannels,
                   m_pAudioFormat->wBitsPerSample,
                   m_pAudioFormat->nBlockAlign);
        }
    } else {
        LogFmt("[CaptureEngine] no WASAPI mix format; recording without system audio\n");
    }

    return m_sinkWriter->BeginWriting();
}

// ── WASAPI loopback ───────────────────────────────────────────────────────────

HRESULT CaptureEngine::InitAudio() {
    winrt::com_ptr<IMMDeviceEnumerator> pEnum;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
        CLSCTX_ALL, IID_PPV_ARGS(pEnum.put()));
    if (FAILED(hr)) return hr;

    winrt::com_ptr<IMMDevice> pDevice;
    hr = pEnum->GetDefaultAudioEndpoint(eRender, eConsole, pDevice.put());
    if (FAILED(hr)) return hr;

    hr = pDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL,
        nullptr, m_audioClient.put_void());
    if (FAILED(hr)) return hr;

    // Use device mix format (usually 32-bit float, 48 kHz, 2ch).
    hr = m_audioClient->GetMixFormat(&m_pAudioFormat);
    if (FAILED(hr)) return hr;

    const REFERENCE_TIME buf100ns = 2 * 10'000'000LL; // 200ms buffer
    hr = m_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        buf100ns, 0, m_pAudioFormat, nullptr);
    if (FAILED(hr)) return hr;

    hr = m_audioClient->GetService(
        __uuidof(IAudioCaptureClient), m_captureClient.put_void());
    if (FAILED(hr)) return hr;

    return m_audioClient->Start();
}

void CaptureEngine::AudioCaptureLoop() {
    // Raise thread priority for audio.
    DWORD taskIndex = 0;
    HANDLE hTask = AvSetMmThreadCharacteristics(L"Audio", &taskIndex);

    while (m_audioRunning) {
        UINT32 packetSize = 0;
        if (FAILED(m_captureClient->GetNextPacketSize(&packetSize)) || packetSize == 0) {
            Sleep(5);
            continue;
        }

        BYTE* pData = nullptr;
        UINT32 numFrames = 0;
        DWORD flags = 0;
        UINT64 devPos = 0, qpcPos = 0;

        HRESULT hr = m_captureClient->GetBuffer(
            &pData, &numFrames, &flags, &devPos, &qpcPos);
        if (FAILED(hr) || numFrames == 0) {
            Sleep(5);
            continue;
        }

        if (m_isPaused ||
            !m_sinkWriterReady.load(std::memory_order_acquire) ||
            !m_hasAudioStream.load(std::memory_order_acquire)) {
            m_captureClient->ReleaseBuffer(numFrames);
            continue;
        }

        bool isSilent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
        UINT32 bytesPerFrame = m_pAudioFormat->nBlockAlign;
        UINT32 dataBytes = numFrames * bytesPerFrame;

        winrt::com_ptr<IMFMediaBuffer> pBuf;
        BYTE* pDest = nullptr;
        if (SUCCEEDED(MFCreateMemoryBuffer(dataBytes, pBuf.put())) &&
            SUCCEEDED(pBuf->Lock(&pDest, nullptr, nullptr))) {
            if (isSilent) {
                ZeroMemory(pDest, dataBytes);
            } else {
                CopyMemory(pDest, pData, dataBytes);
            }
            pBuf->Unlock();
            pBuf->SetCurrentLength(dataBytes);
        }

        m_captureClient->ReleaseBuffer(numFrames);

        if (!pBuf) continue;

        winrt::com_ptr<IMFSample> pSample;
        MFCreateSample(pSample.put());
        pSample->AddBuffer(pBuf.get());

        // Sample-count PTS: monotonic, jitter-free, and naturally handles pause
        // (counter freezes while paused audio is drained without writing).
        LONGLONG dur = (LONGLONG)numFrames * 10'000'000LL / m_pAudioFormat->nSamplesPerSec;

        {
            std::lock_guard<std::mutex> lock(m_mfMutex);
            if (m_sinkWriter && m_hasAudioStream.load(std::memory_order_acquire) && !m_stopping) {
                LONGLONG pts = (LONGLONG)m_audioSamplesWritten * 10'000'000LL
                               / m_pAudioFormat->nSamplesPerSec;
                pSample->SetSampleTime(pts);
                pSample->SetSampleDuration(dur);
                hr = m_sinkWriter->WriteSample(m_audioStream, pSample.get());
                if (SUCCEEDED(hr)) {
                    m_audioSamplesWritten += numFrames;
                } else {
                    LogFmt("[CaptureEngine] WriteSample(audio) failed: 0x%08lX\n", hr);
                }
            }
        }
    }

    if (hTask) AvRevertMmThreadCharacteristics(hTask);
}

// ── Frame arrived callback ────────────────────────────────────────────────────

void CaptureEngine::OnFrameArrived(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& pool,
    winrt::Windows::Foundation::IInspectable const&) {

    if (m_stopping) return;

    // Drain the frame if the sink writer isn't ready yet (MF init still in progress)
    // or if paused — always consume to keep the WGC queue from backing up.
    if (!m_sinkWriterReady.load(std::memory_order_acquire) || m_isPaused) {
        pool.TryGetNextFrame();
        return;
    }

    auto frame = pool.TryGetNextFrame();
    if (!frame) return;

    winrt::com_ptr<ID3D11Texture2D> frameTex;
    try {
        auto surface = frame.Surface();
        auto srcTex  = GetTextureFromSurface(surface);

        if (m_copyTexPool.empty()) {
            LogFmt("[CaptureEngine] copy texture pool is empty\n");
            return;
        }

        // Use a small texture ring. MFCreateDXGISurfaceBuffer wraps the texture,
        // so a single shared texture can be overwritten while the encoder still
        // reads it; allocating a brand-new texture per frame is too expensive
        // during mic/camera recordings.
        frameTex.copy_from(m_copyTexPool[m_copyTexIndex].get());
        m_copyTexIndex = (m_copyTexIndex + 1) % m_copyTexPool.size();

        // Copy to a texture with bind flags the H.264 hardware MFT can read.
        D3D11_TEXTURE2D_DESC srcDesc{};
        srcTex->GetDesc(&srcDesc);
        UINT copyW = std::min(srcDesc.Width,  m_captureW);
        UINT copyH = std::min(srcDesc.Height, m_captureH);
        D3D11_BOX box{ 0, 0, 0, copyW, copyH, 1 };
        m_d3dCtx->CopySubresourceRegion(
            frameTex.get(), 0, 0, 0, 0, srcTex.get(), 0, &box);

        HRESULT hr = WaitForGpuWork(m_d3dDevice.get(), m_d3dCtx.get());
        if (FAILED(hr)) {
            LogFmt("[CaptureEngine] wait for frame copy failed: 0x%08lX\n", hr);
            return;
        }
    } catch (winrt::hresult_error const& e) {
        LogFmt("[CaptureEngine] frame copy failed: 0x%08lX %ls\n",
               static_cast<HRESULT>(e.code()), e.message().c_str());
        return;
    } catch (...) {
        LogFmt("[CaptureEngine] frame copy failed: unknown exception\n");
        return;
    }

    if (!m_sessionStarted) {
        QueryPerformanceCounter(&m_sessionStart);
        m_sessionStarted = true;
    }

    // Create MF sample from the copy texture via DXGI surface buffer.
    winrt::com_ptr<IMFMediaBuffer> pBuf;
    HRESULT hr = MFCreateDXGISurfaceBuffer(
        __uuidof(ID3D11Texture2D), frameTex.get(), 0, FALSE, pBuf.put());
    if (FAILED(hr)) return;

    hr = SetDxgiBufferCurrentLength(pBuf.get());
    if (FAILED(hr)) return;

    winrt::com_ptr<IMFSample> pSample;
    MFCreateSample(pSample.put());
    pSample->AddBuffer(pBuf.get());

    {
        std::lock_guard<std::mutex> lock(m_mfMutex);
        if (m_sinkWriter && !m_stopping) {
            // Frame-count PTS: perfectly monotonic, no wall-clock jitter, and
            // naturally handles pause (counter freezes while paused frames are dropped).
            LONGLONG pts = (LONGLONG)m_framesWritten * 10'000'000LL / m_cfg.fps;
            LONGLONG dur = 10'000'000LL / m_cfg.fps;
            pSample->SetSampleTime(pts);
            pSample->SetSampleDuration(dur);

            hr = m_sinkWriter->WriteSample(m_videoStream, pSample.get());
            if (SUCCEEDED(hr)) {
                m_framesWritten++;

                if (m_framesWritten % 60 == 0) {
                    LogFmt("[CaptureEngine] %llu frames written\n", m_framesWritten);
                }
            } else {
                LogFmt("[CaptureEngine] WriteSample(video) failed: 0x%08lX\n", hr);
            }
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

void CaptureEngine::Start(std::function<void(bool)> completion) {
    HRESULT hr = InitD3D();
    if (FAILED(hr)) { completion(false); return; }

    hr = BuildCaptureItem(m_item);
    if (FAILED(hr)) { completion(false); return; }

    hr = SetupFramePool(m_item);
    if (FAILED(hr)) { completion(false); return; }

    // Start audio (best-effort — some machines have no audio device).
    if (FAILED(InitAudio())) {
        LogFmt("[CaptureEngine] audio init failed; recording without system audio\n");
    } else {
        m_audioRunning = true;
        m_audioThread = std::thread(&CaptureEngine::AudioCaptureLoop, this);
    }

    // Start WGC immediately. Frames are dropped in OnFrameArrived until
    // m_sinkWriterReady is set. "Recording started" is emitted only after the
    // encoder is ready so recordingStartTime in Electron matches PTS=0.
    m_session.StartCapture();
    LogFmt("[CaptureEngine] WGC started (%ux%u @ %dfps), waiting for MF init\n",
           m_captureW, m_captureH, m_cfg.fps);
    completion(true);

    // MFCreateSinkWriterFromURL blocks 2–5 s on Windows. Run on a background
    // thread so the process doesn't stall while waiting. "Recording started" is
    // emitted here (not before) so Electron's recordingStartTime and the camera
    // recorder both start after the encoder is ready — preventing a phantom
    // timeline gap and keeping camera PTS in sync with the screen video.
    m_initThread = std::thread([this]() {
        HRESULT initHr = InitSinkWriter(m_captureW, m_captureH);
        if (SUCCEEDED(initHr)) {
            // Establish the session clock before any frame or audio write can
            // call NowHns(). The release store on m_sinkWriterReady ensures both
            // the video frame callback and audio thread see m_sessionStart set.
            QueryPerformanceCounter(&m_sessionStart);
            m_sessionStarted.store(true, std::memory_order_relaxed);
            m_sinkWriterReady.store(true, std::memory_order_release);
            LogFmt("[CaptureEngine] sink writer ready — recording frames\n");
            // Signal Electron now that the encoder is ready.
            fprintf(stderr, "Recording started\n");
            fflush(stderr);
        } else {
            LogFmt("[CaptureEngine] InitSinkWriter failed: 0x%08lX\n", initHr);
            m_stopping = true;
        }
    });
}

void CaptureEngine::Stop(std::function<void()> completion) {
    m_stopping = true;

    // Wait for background MF init to finish before we touch the sink writer.
    if (m_initThread.joinable()) m_initThread.join();

    // Stop audio thread.
    m_audioRunning = false;
    if (m_audioThread.joinable()) m_audioThread.join();
    if (m_audioClient) m_audioClient->Stop();

    // Unregister the frame callback so no new frames arrive during finalize.
    if (m_session) {
        m_framePool.FrameArrived(m_frameToken);
    }

    // Run Finalize on a background thread with an 8-second watchdog.
    //
    // MF_SINK_WRITER_DISABLE_THROTTLING lets WriteSample accept frames without
    // back-pressure, so the hardware encoder can accumulate a large internal
    // queue during long recordings. Finalize() must drain that queue before it
    // can write the moov atom, which can take tens of seconds. Running it on
    // a separate thread lets us time-box the wait and exit cleanly rather than
    // blocking the parent process indefinitely.
    bool finalizeOk = false;
    if (m_sinkWriter && m_framesWritten > 0) {
        LogFmt("[CaptureEngine] finalizing — written=%llu frames\n", m_framesWritten);

        // Move the sink writer out so audio/video callbacks (already stopped)
        // can't race with the finalizeThread's Release() on timeout.
        winrt::com_ptr<IMFSinkWriter> sw;
        sw.copy_from(m_sinkWriter.get());
        m_sinkWriter = nullptr;

        std::atomic<int> state{0}; // 0=running, 1=ok, 2=failed

        std::thread finalizeThread([sw, &state]() {
            HRESULT hr = sw->Finalize();
            state.store(SUCCEEDED(hr) ? 1 : 2, std::memory_order_release);
            if (FAILED(hr)) {
                LogFmt("[CaptureEngine] Finalize failed: 0x%08lX\n", hr);
            } else {
                LogFmt("[CaptureEngine] Finalize completed\n");
            }
        });

        constexpr DWORD kTimeoutMs = 8000;
        constexpr DWORD kPollMs    = 100;
        for (DWORD elapsed = 0; elapsed < kTimeoutMs; elapsed += kPollMs) {
            if (state.load(std::memory_order_acquire) != 0) break;
            Sleep(kPollMs);
            if (elapsed > 0 && elapsed % 2000 == 0) {
                LogFmt("[CaptureEngine] still finalizing... %lus elapsed\n",
                       (unsigned long)(elapsed / 1000));
            }
        }

        if (state.load(std::memory_order_acquire) != 0) {
            finalizeThread.join();
            finalizeOk = (state.load() == 1);
        } else {
            LogFmt("[CaptureEngine] Finalize timed out after %lus — file will be incomplete\n",
                   (unsigned long)(kTimeoutMs / 1000));
            finalizeThread.detach();
            // Exit immediately via _Exit so we don't run destructors that could
            // race with the still-running finalizeThread.
            std::_Exit(1);
        }
    } else if (m_sinkWriter) {
        m_sinkWriter = nullptr;
    }

    // Close WGC session and frame pool.
    if (m_session) {
        m_session.Close();
        m_framePool.Close();
    }

    if (completion) completion();

    // Exit non-zero when Finalize completed but returned an error (file may be
    // unreadable), so the parent process can trigger recovery logic.
    if (!finalizeOk && m_framesWritten > 0) {
        std::_Exit(1);
    }
}

void CaptureEngine::Pause() {
    if (m_isPaused) return;
    m_isPaused = true;
    m_pauseStart = NowHns() + m_pauseOffset; // absolute time of pause
    LogFmt("[CaptureEngine] paused\n");
}

void CaptureEngine::Resume() {
    if (!m_isPaused) return;
    LONGLONG now;
    {
        LARGE_INTEGER li;
        QueryPerformanceCounter(&li);
        now = (LONGLONG)((double)(li.QuadPart - m_sessionStart.QuadPart)
                         / m_perfFreq.QuadPart * 10'000'000.0);
    }
    m_pauseOffset += (now - m_pauseStart);
    m_isPaused = false;
    LogFmt("[CaptureEngine] resumed (pauseOffset=%.3fs)\n",
           m_pauseOffset / 10'000'000.0);
}
