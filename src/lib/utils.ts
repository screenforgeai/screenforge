import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

const THUMBNAIL_IMAGE_TYPE = 'image/jpeg';
const THUMBNAIL_IMAGE_QUALITY = 0.7;
const BLANK_SAMPLE_SIZE = 24;
const BLANK_ALPHA_THRESHOLD = 8;
const BLANK_LUMA_THRESHOLD = 6;

export function isPixelBufferLikelyBlank(data: ArrayLike<number>): boolean {
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) {
    return true;
  }

  let alphaTotal = 0;
  let maxLuma = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3] ?? 0;
    alphaTotal += alpha;

    if (alpha <= BLANK_ALPHA_THRESHOLD) {
      continue;
    }

    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const alphaRatio = alpha / 255;
    const luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alphaRatio;
    maxLuma = Math.max(maxLuma, luma);
  }

  return alphaTotal / pixelCount <= BLANK_ALPHA_THRESHOLD || maxLuma <= BLANK_LUMA_THRESHOLD;
}

export function isCanvasLikelyBlank(canvas: HTMLCanvasElement): boolean {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return true;
  }

  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.min(BLANK_SAMPLE_SIZE, canvas.width);
    sampleCanvas.height = Math.min(BLANK_SAMPLE_SIZE, canvas.height);

    const context = sampleCanvas.getContext('2d');
    if (!context) {
      return false;
    }

    context.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    return isPixelBufferLikelyBlank(pixels);
  } catch {
    return false;
  }
}

export function captureCanvasFrame(canvas: HTMLCanvasElement): string {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return '';
  }

  try {
    return canvas.toDataURL(THUMBNAIL_IMAGE_TYPE, THUMBNAIL_IMAGE_QUALITY);
  } catch {
    return '';
  }
}

export function captureFrame(video: HTMLVideoElement): string {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return '';
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return canvas.toDataURL(THUMBNAIL_IMAGE_TYPE, THUMBNAIL_IMAGE_QUALITY);
  } catch {
    return '';
  }
}

export function captureProjectThumbnail({
  canvas,
  video,
  existingThumbnail,
}: {
  canvas?: HTMLCanvasElement | null;
  video?: HTMLVideoElement | null;
  existingThumbnail?: string | null;
}): string {
  if (canvas) {
    const canvasThumbnail = captureCanvasFrame(canvas);
    if (canvasThumbnail && !isCanvasLikelyBlank(canvas)) {
      return canvasThumbnail;
    }
  }

  const videoThumbnail = video ? captureFrame(video) : '';
  if (videoThumbnail) {
    return videoThumbnail;
  }

  if (existingThumbnail && existingThumbnail.length > 0) {
    return existingThumbnail;
  }

  return '';
}
