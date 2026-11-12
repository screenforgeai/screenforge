import type { ScreenshotCapture } from 'src/types';

/** The image types the Screenshot editor opens from disk. */
export const OPENABLE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * An image file the user picked, as a screenshot for the editor: a blob: URL (the editor
 * releases it when it closes) and the image's own size. Null when it is not a readable image.
 */
export const captureFromImageFile = async (file: File): Promise<ScreenshotCapture | null> => {
  if (!OPENABLE_IMAGE_TYPES.includes(file.type)) {
    return null;
  }
  const imageUrl = URL.createObjectURL(file);
  try {
    const { width, height } = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('Not a readable image'));
        image.src = imageUrl;
      },
    );
    if (!width || !height) {
      throw new Error('Empty image');
    }
    return { kind: 'area', imageUrl, width, height };
  } catch {
    URL.revokeObjectURL(imageUrl);
    return null;
  }
};
