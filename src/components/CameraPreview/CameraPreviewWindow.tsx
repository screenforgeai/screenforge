import { useEffect, useRef } from 'react';

export const CameraPreviewWindow = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const start = async () => {
      const deviceId = await window.screenforge.getCameraPreviewDeviceId();
      if (cancelled) {
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => undefined);
      }
    };

    start().catch(() => undefined);

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      window.screenforge.writeDiagnosticLog('camera-preview.pointerdown', {
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: window.screenX,
        screenY: window.screenY,
        target: (e.target as Element)?.className ?? null,
      });
    };
    const onPointerMove = (e: PointerEvent) => {
      window.screenforge.writeDiagnosticLog('camera-preview.pointermove', {
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: window.screenX,
        screenY: window.screenY,
      });
    };
    const onMouseDown = (e: MouseEvent) => {
      window.screenforge.writeDiagnosticLog('camera-preview.mousedown', {
        clientX: e.clientX,
        clientY: e.clientY,
        buttons: e.buttons,
      });
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  return (
    <div
      className="app-drag relative h-screen w-screen overflow-hidden bg-[#0b0b10]/85"
      style={{ borderRadius: 66 }}
    >
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
    </div>
  );
};
