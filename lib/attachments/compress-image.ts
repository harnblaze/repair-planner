import { fitWithin, JPEG_QUALITY, MAX_SIDE } from "@/lib/business/attachments";

// Только браузер: уменьшение фото до MAX_SIDE по длинной стороне и JPEG.
// Перекодирование отбрасывает EXIF, включая GPS. Поворот из EXIF
// применяется при декодировании.

export class UnsupportedImageError extends Error {}

export type CompressedImage = { blob: Blob; width: number; height: number };

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Например, HEIC в браузере без поддержки — пробуем через <img>.
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new UnsupportedImageError();
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const decoded = await decode(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new UnsupportedImageError();
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    // iOS Safari держит память canvas до сборки мусора — освобождаем сразу.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new UnsupportedImageError();
    return { blob, width, height };
  } finally {
    decoded.release();
  }
}
