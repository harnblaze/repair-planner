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

/**
 * Папка фото задачи. Нижний регистр — как Postgres печатает uuid: CHECK пути
 * и политики storage.objects сравнивают с project_id::text, а id из URL
 * может прийти и в верхнем регистре.
 */
export function attachmentFolder(projectId: string, taskId: string): string {
  return `${projectId}/${taskId}`.toLowerCase();
}

export function buildAttachmentPath(projectId: string, taskId: string, fileId: string): string {
  return `${attachmentFolder(projectId, taskId)}/${fileId}.jpg`;
}

/** Путь ровно вида {projectId}/{taskId}/{uuid}.jpg — без лишних сегментов и `..`. */
export function isValidAttachmentPath(path: string, projectId: string, taskId: string): boolean {
  const prefix = `${attachmentFolder(projectId, taskId)}/`;
  return path.startsWith(prefix) && FILE_NAME_RE.test(path.slice(prefix.length));
}

export function isValidDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;
}

/**
 * Ссылки на фото, которые браузер уже загрузил. Каждый рендер страницы
 * подписывает фото заново, а новый токен — новый URL, мимо кеша браузера:
 * без этого любое действие в карточке заново скачивало бы все фото.
 * Удалённые фото выпадают, новые добавляются.
 */
export function rememberSignedUrls(
  cache: Readonly<Record<string, string>>,
  photos: readonly { id: string; url: string | null }[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const photo of photos) {
    const url = cache[photo.id] ?? photo.url;
    if (url) next[photo.id] = url;
  }
  return next;
}

/** Запомненная ссылка истекла: перейти на свежую из последнего рендера, если она другая. */
export function urlAfterLoadError(failedUrl: string, freshUrl: string | null): string | null {
  return freshUrl && freshUrl !== failedUrl ? freshUrl : null;
}

/** Число фото из встроенного подсчёта Supabase `task_attachments(count)` — значок на карточке доски. */
export function toPhotoCount(rows: { count: number }[] | null | undefined): number {
  return rows?.[0]?.count ?? 0;
}

// ── Фото в чате ──────────────────────────────────────────────────────────────
// Отдельный bucket: у фото переписки свои политики, и они не должны смешиваться
// с политиками заявок (доступ к чату шире, чем к заявке).

export const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
/** Столько же разрешает RPC create_chat_message (0037) — числа обязаны совпадать. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

/** Сообщения об ошибках вложений чата: не в lib/errors.ts, чтобы не было цикла импортов. */
export const CHAT_ATTACHMENT_MESSAGES = {
  limitReached: `К сообщению можно приложить не больше ${MAX_ATTACHMENTS_PER_MESSAGE} фото.`,
  unsupported: "Этот формат фото не поддерживается. Сохраните его как JPEG.",
  tooLarge: "Фото слишком большое.",
  uploadFailed: "Не удалось загрузить фото. Попробуйте ещё раз.",
} as const;

/** Папка фото сообщения. Нижний регистр — как Postgres печатает uuid в CHECK пути. */
export function chatAttachmentFolder(projectId: string, messageId: string): string {
  return `${projectId}/${messageId}`.toLowerCase();
}

export function chatAttachmentPath(projectId: string, messageId: string, fileId: string): string {
  return `${chatAttachmentFolder(projectId, messageId)}/${fileId}.jpg`;
}

/** Путь ровно вида {projectId}/{messageId}/{uuid}.jpg — без лишних сегментов и `..`. */
export function isValidChatAttachmentPath(path: string, projectId: string, messageId: string): boolean {
  const prefix = `${chatAttachmentFolder(projectId, messageId)}/`;
  return path.startsWith(prefix) && FILE_NAME_RE.test(path.slice(prefix.length));
}

export function canAddAttachment(count: number): boolean {
  return count < MAX_ATTACHMENTS_PER_MESSAGE;
}

/**
 * Почему файл нельзя приложить; null — можно. Проверки идут от самого частого:
 * формат, размер, лимит по числу — и текст говорит, что именно не так.
 */
export function firstAttachmentError(
  file: { type: string; size: number },
  count: number,
): string | null {
  if (!file.type.startsWith("image/")) return CHAT_ATTACHMENT_MESSAGES.unsupported;
  if (file.size > MAX_SOURCE_BYTES) return CHAT_ATTACHMENT_MESSAGES.tooLarge;
  if (!canAddAttachment(count)) return CHAT_ATTACHMENT_MESSAGES.limitReached;
  return null;
}
