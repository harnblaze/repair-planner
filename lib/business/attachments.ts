// Фото к задачам: константы и чистые функции, общие для браузера и сервера
// (docs/superpowers/specs/2026-10-07-task-attachments-design.md).

export const ATTACHMENTS_BUCKET = "task-attachments";
/** Мягкий лимит: проверяется перед выдачей ссылки на загрузку. */
export const MAX_ATTACHMENTS_PER_TASK = 30;
/** Исходник до сжатия: больше — телефон может не справиться с декодированием. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.85;
export const SIGNED_URL_TTL_SECONDS = 3600;

const FILE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** Размеры после уменьшения до maxSide по длинной стороне; маленькие фото не увеличиваются. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= maxSide && height <= maxSide) {
    return { width, height };
  }
  const scale = maxSide / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function buildAttachmentPath(projectId: string, taskId: string, fileId: string): string {
  return `${projectId}/${taskId}/${fileId}.jpg`;
}

/** Путь ровно вида {projectId}/{taskId}/{uuid}.jpg — без лишних сегментов и `..`. */
export function isValidAttachmentPath(path: string, projectId: string, taskId: string): boolean {
  const prefix = `${projectId}/${taskId}/`;
  return path.startsWith(prefix) && FILE_NAME_RE.test(path.slice(prefix.length));
}

export function isValidDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;
}
