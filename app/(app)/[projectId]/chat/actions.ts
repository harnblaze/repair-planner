"use server";

import { randomUUID } from "node:crypto";

import {
  CHAT_ATTACHMENTS_BUCKET,
  CHAT_ATTACHMENT_MESSAGES,
  CHAT_DOCUMENT_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  SIGNED_URL_TTL_SECONDS,
  chatAttachmentFolder,
  chatAttachmentPath,
  documentExtensionFor,
  documentMimeFor,
  isValidChatAttachmentPath,
  isValidDimension,
} from "@/lib/business/attachments";
import type { ChatAttachment, ChatMessage, ChatReaction } from "@/lib/business/chat";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole, requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { CHAT_PAGE_SIZE, escapeLikePattern, fromChatRow } from "@/lib/business/chat";
import {
  CHAT_BODY_MAX,
  chatEditSchema,
  chatMessageSchema,
  chatMessageWithAttachmentsSchema,
  reactionSchema,
  type ChatMessageInput,
  type ChatMessageWithAttachmentsInput,
} from "@/lib/validation/chat";

// Мутации чата идут через серверные экшены, а не через браузерный клиент:
// браузерный клиент в проекте живёт только подпиской на Realtime.

const INVALID: { ok: false; error: string } = {
  ok: false,
  error: "Проверьте сообщение: оно не должно быть пустым и длиннее 2000 символов.",
};

/** Строка сообщения с вложенными реакциями и файлами: так их отдаёт PostgREST. */
type MessageRow = {
  id: string;
  project_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_author_id: string | null;
  project_message_reactions: { user_id: string; emoji: string }[] | null;
  project_message_attachments:
    | {
        id: string;
        storage_path: string;
        kind: string;
        mime_type: string | null;
        file_name: string | null;
        size_bytes: number;
        width: number | null;
        height: number | null;
      }[]
    | null;
};

function toMessage(row: MessageRow): ChatMessage {
  // Цитату собирает fromChatRow из снимка: join тут не нужен, и Realtime с ним
  // тоже работал бы — там приходят только колонки строки.
  return fromChatRow(row);
}

function toReactions(row: MessageRow): ChatReaction[] {
  return (row.project_message_reactions ?? []).map((reaction) => ({
    message_id: row.id,
    user_id: reaction.user_id,
    emoji: reaction.emoji,
  }));
}

/** Вложения строки + ссылки, подписанные на весь список сообщений одним запросом. */
function toAttachments(row: MessageRow, urlByPath: Map<string, string>): ChatAttachment[] {
  return (row.project_message_attachments ?? []).map((attachment) => ({
    id: attachment.id,
    message_id: row.id,
    storage_path: attachment.storage_path,
    kind: attachment.kind === "document" ? "document" : "image",
    mime_type: attachment.mime_type,
    file_name: attachment.file_name,
    size_bytes: attachment.size_bytes,
    width: attachment.width,
    height: attachment.height,
    url: urlByPath.get(attachment.storage_path) ?? null,
  }));
}

/**
 * Подписанные ссылки на фото: bucket приватный, ссылки живут час. Ошибка
 * подписи не роняет загрузку чата — фото просто не покажется, а текст будет.
 */
async function signAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: MessageRow[],
): Promise<Map<string, string>> {
  const paths = rows.flatMap((row) => (row.project_message_attachments ?? []).map((a) => a.storage_path));
  if (paths.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error("signAttachments:", error);
    return new Map();
  }
  // path и signedUrl в ответе nullable: подписанные кладём, остальные пропускаем.
  const result = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) result.set(item.path, item.signedUrl);
  }
  return result;
}

export type ChatSendResult = { ok: true; message: ChatMessage } | { ok: false; error: string };
export type ChatEditResult = { ok: true; message: ChatMessage } | { ok: false; error: string };
export type ChatDeleteResult = { ok: true } | { ok: false; error: string };

/** Курсор истории: сообщение, до которого уже догружено (самое старое в ленте). */
export type ChatHistoryCursor = { createdAt: string; id: string };

export type ChatLoadResult =
  | {
      ok: true;
      messages: ChatMessage[];
      reactions: ChatReaction[];
      attachments: ChatAttachment[];
      /** Есть ли ещё более ранние сообщения — по этому флагу живёт кнопка. */
      hasMore: boolean;
    }
  | { ok: false; error: string };

/**
 * Время для фильтра PostgREST. Смещение UTC переводим в «Z»: «+» в строке
 * запроса декодируется как пробел, и сервер получил бы битую дату.
 */
function cursorTime(iso: string): string {
  return iso.replace(" ", "T").replace(/\+00:00$/, "Z");
}

/** Оригинал ответа пропал, пока его выбирали (удалили в другой вкладке). */
const REPLY_GONE = {
  ok: false as const,
  error: "Сообщение, на которое отвечаете, больше недоступно.",
};

/**
 * Проверка адресата ответа до вставки: понятная ошибка вместо текста триггера.
 * Повторная проверка стоит в БД (0039) — клиенту верить нельзя.
 */
async function replyTargetExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  replyToId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("project_messages")
    .select("id")
    .eq("id", replyToId)
    .eq("project_id", projectId)
    .maybeSingle();
  return Boolean(data);
}

/** Отправка: id приходит от клиента и связывает оптимистичную вставку с серверной строкой. */
export async function sendMessageAction(
  projectId: string,
  input: ChatMessageInput,
): Promise<ChatSendResult> {
  const denied = await requireProjectEdit(projectId);
  // requireProjectEdit отдаёт ActionResult: у неуспеха есть текст для человека.
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  const parsed = chatMessageSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  if (parsed.data.body.length > CHAT_BODY_MAX) return INVALID;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Сессия истекла. Войдите заново." };

  if (parsed.data.replyToId && !(await replyTargetExists(supabase, projectId, parsed.data.replyToId))) {
    return REPLY_GONE;
  }

  const { data, error } = await supabase
    .from("project_messages")
    .insert({
      id: parsed.data.id,
      project_id: projectId,
      author_id: user.id,
      body: parsed.data.body,
      reply_to_id: parsed.data.replyToId ?? null,
    })
    .select("id, project_id, author_id, body, created_at, edited_at, reply_to_id, reply_to_body, reply_to_author_id")
    .single();

  if (error || !data) {
    console.error("sendMessageAction:", error);
    // Триггер 0039 не нашёл оригинал (его удалили между выбором и отправкой).
    if (error?.message?.includes("reply_target_invalid")) return REPLY_GONE;
    return { ok: false, error: "Не удалось отправить сообщение. Попробуйте ещё раз." };
  }

  return { ok: true, message: fromChatRow(data) };
}

/**
 * Последние сообщения и их реакции — для первого рендера и дозапроса после
 * реконнекта. С курсором `before` отдаёт предыдущую страницу истории (кнопка
 * «Показать более ранние»).
 *
 * Порядок — по времени, при равенстве по id: uuid сравнимы в Postgres, и такой
 * же вторичный ключ стоит в курсоре. Одного created_at мало: несколько
 * сообщений в одну микросекунду отличимы только по id, и без него страница
 * либо зацикливалась бы, либо теряла строки.
 */
export async function loadMessagesAction(
  projectId: string,
  before?: ChatHistoryCursor,
): Promise<ChatLoadResult> {
  const role = await getProjectRole(projectId);
  if (!role) return { ok: false, error: "Нет доступа к проекту." };

  const supabase = await createClient();
  let query = supabase
    .from("project_messages")
    .select(
      "id, project_id, author_id, body, created_at, edited_at, reply_to_id, reply_to_body, reply_to_author_id, project_message_reactions(user_id, emoji), project_message_attachments(id, storage_path, kind, mime_type, file_name, size_bytes, width, height)",
    )
    .eq("project_id", projectId);

  if (before) {
    const at = cursorTime(before.createdAt);
    // Строго до курсора; при совпадении времени — по id, чтобы страницы не
    // пересекались и не теряли сообщения одного «момента».
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${before.id})`);
  }

  // На одну строку больше страницы: по ней честно видно, есть ли что-то раньше.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_PAGE_SIZE + 1);

  if (error) {
    console.error("loadMessagesAction:", error);
    return { ok: false, error: "Не удалось загрузить чат." };
  }

  const fetched = (data ?? []) as MessageRow[];
  // Заказано «от новых к старым», поэтому лишняя строка — самая старая из
  // выборки: её отдадим следующим нажатием, чтобы не отдавать меньше страницы.
  const hasMore = fetched.length > CHAT_PAGE_SIZE;
  const rows = hasMore ? fetched.slice(0, CHAT_PAGE_SIZE) : fetched;
  const urlByPath = await signAttachments(supabase, rows);

  // Уборка «сирот» по активности: не чаще раза в сутки на проект. Ошибки
  // глушатся внутри — чат не должен зависеть от уборки.
  if (canEditProject(role)) await maybeCleanupChatOrphans(projectId);

  return {
    ok: true,
    messages: rows.map(toMessage).reverse(),
    reactions: rows.flatMap(toReactions),
    attachments: rows.flatMap((row) => toAttachments(row, urlByPath)),
    hasMore,
  };
}

const SEARCH_LIMIT = 20;
const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_CHARS = 100;

/**
 * Поиск по тексту переписки. Историю ищет сервер: лента помнит 50 сообщений.
 */
export async function searchMessagesAction(
  projectId: string,
  query: string,
): Promise<{ ok: true; messages: ChatMessage[] } | { ok: false; error: string }> {
  const role = await getProjectRole(projectId);
  if (!role) return { ok: false, error: "Нет доступа к проекту." };

  const term = query.trim().slice(0, SEARCH_MAX_CHARS);
  if (term.length < SEARCH_MIN_CHARS) {
    return { ok: false, error: "Введите хотя бы два символа." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_messages")
    .select("id, project_id, author_id, body, created_at, edited_at, reply_to_id, reply_to_body, reply_to_author_id, project_message_attachments(id)")
    .eq("project_id", projectId)
    .ilike("body", `%${escapeLikePattern(term)}%`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SEARCH_LIMIT);

  if (error) {
    console.error("searchMessagesAction:", error);
    return { ok: false, error: "Не удалось выполнить поиск. Попробуйте ещё раз." };
  }

  /** В выборке поиска от вложений нужен только факт: скрепка в строке результата. */
  type SearchRow = {
    id: string;
    project_id: string;
    author_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
    project_message_attachments: { id: string }[] | null;
  };

  return {
    ok: true,
    messages: ((data ?? []) as SearchRow[]).map((row) => ({
      id: row.id,
      project_id: row.project_id,
      author_id: row.author_id,
      body: row.body,
      created_at: row.created_at,
      edited_at: row.edited_at,
      has_attachments: (row.project_message_attachments ?? []).length > 0,
    })),
  };
}

/**
 * Правка своего сообщения. Чужое не обновится: условие стоит и в запросе, и в
 * RLS-политике (0036) — политика не должна зависеть от аккуратности экшена.
 */
export async function editMessageAction(
  projectId: string,
  messageId: string,
  body: string,
): Promise<ChatEditResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  const parsed = chatEditSchema.safeParse({ messageId, body });
  if (!parsed.success) return INVALID;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Сессия истекла. Войдите заново." };

  const { data, error } = await supabase
    .from("project_messages")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.messageId)
    .eq("project_id", projectId)
    .eq("author_id", user.id)
    .select("id, project_id, author_id, body, created_at, edited_at")
    .maybeSingle();

  if (error) {
    console.error("editMessageAction:", error);
    return { ok: false, error: "Не удалось изменить сообщение. Попробуйте ещё раз." };
  }
  if (!data) return { ok: false, error: "Можно править только свои сообщения." };

  return { ok: true, message: data };
}

/** Удаление своего сообщения: реакции уходят каскадом на стороне БД. */
export async function deleteMessageAction(
  projectId: string,
  messageId: string,
): Promise<ChatDeleteResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  if (!chatEditSchema.shape.messageId.safeParse(messageId).success) {
    return { ok: false, error: "Сообщение не найдено." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Сессия истекла. Войдите заново." };

  // Пути фото читаем до удаления: каскад уберёт строки, но не файлы.
  const { data: files } = await supabase
    .from("project_message_attachments")
    .select("storage_path")
    .eq("message_id", messageId)
    .eq("project_id", projectId);

  // select нужен, чтобы отличить «удалили» от «нечего было удалять»: RLS молча
  // не отдаёт чужие строки, и без этого чужая попытка выглядела бы успехом.
  const { data, error } = await supabase
    .from("project_messages")
    .delete()
    .eq("id", messageId)
    .eq("project_id", projectId)
    .eq("author_id", user.id)
    .select("id");

  if (error) {
    console.error("deleteMessageAction:", error);
    return { ok: false, error: "Не удалось удалить сообщение. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Можно удалять только свои сообщения." };
  }

  // Файлы удаляем после строки: сбой Storage оставит «сироту», которую уберёт
  // chat_attachment_orphans, а не битую ссылку в ленте у собеседника.
  const paths = (files ?? []).map((file) => file.storage_path);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(CHAT_ATTACHMENTS_BUCKET).remove(paths);
    if (removeError) console.error("deleteMessageAction (storage, orphan left):", removeError);
  }

  return { ok: true };
}

export type ChatReactionResult = { ok: true; added: boolean } | { ok: false; error: string };

const REACTION_FAILED: { ok: false; error: string } = {
  ok: false,
  error: "Не удалось поставить реакцию. Попробуйте ещё раз.",
};

/** Поставить или снять свою реакцию: повторный клик по тому же эмодзи снимает её. */
export async function toggleReactionAction(
  projectId: string,
  messageId: string,
  emoji: string,
): Promise<ChatReactionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  const parsed = reactionSchema.safeParse({ messageId, emoji });
  if (!parsed.success) return { ok: false, error: "Такой реакции нет." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Сессия истекла. Войдите заново." };

  // id сообщения приходит с клиента: без проверки проекта можно было бы цеплять
  // реакции к сообщениям чужого проекта — политика опирается на членство.
  const { data: message } = await supabase
    .from("project_messages")
    .select("id")
    .eq("id", parsed.data.messageId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!message) return { ok: false, error: "Сообщение не найдено." };

  const { data: existing, error: readError } = await supabase
    .from("project_message_reactions")
    .select("emoji")
    .eq("message_id", parsed.data.messageId)
    .eq("user_id", user.id)
    .eq("emoji", parsed.data.emoji)
    .maybeSingle();

  if (readError) {
    console.error("toggleReactionAction:read", readError);
    return REACTION_FAILED;
  }

  const { error } = existing
    ? await supabase
        .from("project_message_reactions")
        .delete()
        .eq("message_id", parsed.data.messageId)
        .eq("user_id", user.id)
        .eq("emoji", parsed.data.emoji)
    : await supabase.from("project_message_reactions").insert({
        message_id: parsed.data.messageId,
        user_id: user.id,
        emoji: parsed.data.emoji,
      });

  if (error) {
    console.error("toggleReactionAction:write", error);
    return REACTION_FAILED;
  }

  return { ok: true, added: !existing };
}

/** Отметка «прочитано до»: по ней считается непрочитанное. */export async function markChatReadAction(projectId: string): Promise<{ ok: boolean }> {
  const role = await getProjectRole(projectId);
  if (!role) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("project_message_reads")
    .upsert(
      { project_id: projectId, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: "project_id,user_id" },
    );

  if (error) {
    console.error("markChatReadAction:", error);
    return { ok: false };
  }

  return { ok: true };
}

// ── Фото в сообщениях ────────────────────────────────────────────────────────
// Загрузка в три шага, как у фото заявок (0017): сервер выдаёт ссылку на свой
// путь → браузер кладёт байты прямо в Storage → сервер проверяет объект и
// пишет сообщение с вложениями одной транзакцией (RPC 0037).

export type ChatUploadStart =
  | { ok: true; path: string; signedUrl: string }
  | { ok: false; error: string };

const CHAT_UPLOAD_FAILED = "Не удалось загрузить файл. Попробуйте ещё раз.";

/** Что клиент знает о файле до загрузки: тип и настоящее имя (для документов). */
export type ChatUploadMeta = {
  kind: "image" | "document";
  mimeType: string;
  fileName: string;
};

/**
 * Расширение пути по метаданным: фото всегда jpg (его сжимает браузер), у
 * документа — по MIME, с запасом по имени файла (у .txt MIME бывает пустым).
 */
function uploadExtension(meta: ChatUploadMeta): string | null {
  if (meta.kind === "image") return "jpg";
  const byMime = documentExtensionFor(meta.mimeType);
  if (byMime) return byMime;
  const mime = documentMimeFor(meta.fileName);
  return mime ? documentExtensionFor(mime) : null;
}

/**
 * Ссылка на загрузку одного файла. id сообщения генерирует клиент и присылает
 * заранее: путь должен содержать его, чтобы RLS Storage проверил проект.
 */
export async function startChatAttachmentUploadAction(
  projectId: string,
  messageId: string,
  meta: ChatUploadMeta,
): Promise<ChatUploadStart> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  if (!chatEditSchema.shape.messageId.safeParse(messageId).success) {
    return { ok: false, error: CHAT_UPLOAD_FAILED };
  }

  const extension = uploadExtension(meta);
  if (!extension) return { ok: false, error: CHAT_ATTACHMENT_MESSAGES.documentUnsupported };

  const supabase = await createClient();
  const path = chatAttachmentPath(projectId, messageId, randomUUID(), extension);
  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("startChatAttachmentUploadAction:", error);
    return { ok: false, error: CHAT_UPLOAD_FAILED };
  }

  return { ok: true, path, signedUrl: data.signedUrl };
}

export type ChatSendWithAttachmentsResult =
  | { ok: true; message: ChatMessage; attachments: ChatAttachment[] }
  | { ok: false; error: string };

const RPC_ERRORS: Record<string, string> = {
  message_empty: "Добавьте текст или приложите файл.",
  attachments_too_many: `К сообщению можно приложить не больше ${MAX_ATTACHMENTS_PER_MESSAGE} файлов.`,
  attachment_path_mismatch: CHAT_UPLOAD_FAILED,
  attachments_invalid: CHAT_UPLOAD_FAILED,
  attachment_kind_unknown: CHAT_ATTACHMENT_MESSAGES.unsupported,
  attachment_image_size_missing: "Не удалось определить размеры фото. Попробуйте другое фото.",
  attachment_document_has_size: CHAT_UPLOAD_FAILED,
  attachment_mime_mismatch: CHAT_ATTACHMENT_MESSAGES.unsupported,
};

/** Вложение в том виде, в каком его ждёт RPC (0038): ключи jsonb. */
type RpcAttachment = {
  path: string;
  kind: "image" | "document";
  mime_type: string;
  file_name: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
};

/** Сообщение с файлами: тела может не быть, размер берём из Storage, а не от клиента. */
export async function sendMessageWithAttachmentsAction(
  projectId: string,
  input: ChatMessageWithAttachmentsInput,
): Promise<ChatSendWithAttachmentsResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  const parsed = chatMessageWithAttachmentsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Добавьте текст или файл — и не больше четырёх." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Сессия истекла. Войдите заново." };

  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const folder = parsed.data.id.toLowerCase();
  const attachments: RpcAttachment[] = [];

  for (const attachment of parsed.data.attachments) {
    if (!isValidChatAttachmentPath(attachment.path, projectId, parsed.data.id)) {
      return { ok: false, error: CHAT_UPLOAD_FAILED };
    }

    if (attachment.kind === "image") {
      if (!isValidDimension(attachment.width) || !isValidDimension(attachment.height)) {
        return { ok: false, error: CHAT_UPLOAD_FAILED };
      }
    } else {
      // MIME документа выводим из расширения пути: он уже проверен сервером при
      // выдаче ссылки, и RPC сверит mime с расширением — расходиться нельзя.
      const extension = attachment.path.split(".").pop()?.toLowerCase() ?? "";
      if (!CHAT_DOCUMENT_TYPES.some((type) => type.extension === extension)) {
        return { ok: false, error: CHAT_ATTACHMENT_MESSAGES.documentUnsupported };
      }
    }

    // Префикс — именно папка: chatAttachmentPath с пустым fileId вернул бы
    // «…/{id}/.jpg», и длина префикса оказалась бы на расширение больше —
    // имя файла обрезалось бы неправильно, а поиск в Storage ничего не находил.
    const prefix = `${chatAttachmentFolder(projectId, parsed.data.id)}/`;
    const fileName = attachment.path.slice(prefix.length);
    const { data: objects, error: listError } = await bucket.list(`${projectId}/${folder}`, {
      search: fileName,
      limit: 1,
    });
    const object = objects?.find((item) => item.name === fileName);
    const size = Number(object?.metadata?.size);

    if (listError || !object || !(size > 0)) {
      console.error("sendMessageWithAttachmentsAction (object):", listError ?? attachment.path);
      return { ok: false, error: CHAT_UPLOAD_FAILED };
    }

    if (attachment.kind === "document" && size > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: CHAT_ATTACHMENT_MESSAGES.documentTooLarge };
    }

    const extension = attachment.path.split(".").pop()?.toLowerCase() ?? "";
    const known = CHAT_DOCUMENT_TYPES.find((type) => type.extension === extension);

    attachments.push({
      path: attachment.path,
      kind: attachment.kind,
      mime_type: attachment.kind === "image" ? "image/jpeg" : (known?.mime ?? attachment.mimeType),
      file_name: attachment.fileName,
      size_bytes: size,
      width: attachment.kind === "image" ? (attachment.width ?? null) : null,
      height: attachment.kind === "image" ? (attachment.height ?? null) : null,
    });
  }

  if (parsed.data.replyToId && !(await replyTargetExists(supabase, projectId, parsed.data.replyToId))) {
    return REPLY_GONE;
  }

  const { data: messageRow, error } = await supabase.rpc("create_chat_message", {
    p_project_id: projectId,
    p_id: parsed.data.id,
    p_body: parsed.data.body,
    p_attachments: attachments,
    // Аргумент необязательный: явный null тип не принимает, undefined — да.
    p_reply_to_id: parsed.data.replyToId,
  });

  if (error || !messageRow) {
    const known = Object.keys(RPC_ERRORS).find((code) => error?.message?.includes(code));
    console.error("sendMessageWithAttachmentsAction (rpc):", error);
    if (error?.message?.includes("reply_target_invalid")) return REPLY_GONE;
    return { ok: false, error: known ? RPC_ERRORS[known] : CHAT_UPLOAD_FAILED };
  }

  const message = fromChatRow(messageRow);

  const { data: rows, error: rowsError } = await supabase
    .from("project_message_attachments")
    .select("id, storage_path, kind, mime_type, file_name, size_bytes, width, height")
    .eq("message_id", parsed.data.id)
    .eq("project_id", projectId);

  if (rowsError) console.error("sendMessageWithAttachmentsAction (rows):", rowsError);

  const urlByPath = await signAttachments(
    supabase,
    (rows ?? []).map((row) => ({
      ...messageRow,
      project_message_reactions: null,
      project_message_attachments: [row],
    })) as MessageRow[],
  );

  return {
    ok: true,
    message,
    attachments: (rows ?? []).map((row) => ({
      id: row.id,
      message_id: parsed.data.id,
      storage_path: row.storage_path,
      kind: row.kind === "document" ? "document" : "image",
      mime_type: row.mime_type,
      file_name: row.file_name,
      size_bytes: row.size_bytes,
      width: row.width,
      height: row.height,
      url: urlByPath.get(row.storage_path) ?? null,
    })),
  };
}

/**
 * Уборка файлов-«сирот»: старше суток и без строки в таблице. Крона на хостинге
 * нет, поэтому уборка идёт по активности — не чаще раза в сутки на проект
 * (claim_chat_cleanup), а при сбое отметка снимается, чтобы не ждать сутки.
 *
 * Сбой уборки не должен ломать чат: пользователь ничего не заметит, а причина
 * останется в логе.
 */
export async function maybeCleanupChatOrphans(projectId: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: claimed, error: claimError } = await supabase.rpc("claim_chat_cleanup", {
      p_project_id: projectId,
    });
    if (claimError) {
      console.error("claim_chat_cleanup:", claimError);
      return;
    }
    if (!claimed) return;

    const { data: paths, error: listError } = await supabase.rpc("chat_attachment_orphans", {
      p_project_id: projectId,
      p_limit: 100,
    });

    if (listError) {
      console.error("chat_attachment_orphans:", listError);
      await supabase.rpc("release_chat_cleanup", { p_project_id: projectId });
      return;
    }

    const orphans = (paths ?? []).filter((path): path is string => typeof path === "string");
    if (orphans.length === 0) return;

    const { error: removeError } = await supabase.storage.from(CHAT_ATTACHMENTS_BUCKET).remove(orphans);
    if (removeError) {
      console.error("maybeCleanupChatOrphans (remove):", removeError);
      await supabase.rpc("release_chat_cleanup", { p_project_id: projectId });
    }
  } catch (error) {
    console.error("maybeCleanupChatOrphans:", error);
  }
}
