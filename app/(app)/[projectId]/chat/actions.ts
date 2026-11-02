"use server";

import { randomUUID } from "node:crypto";

import {
  CHAT_ATTACHMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  chatAttachmentPath,
  isValidChatAttachmentPath,
  isValidDimension,
} from "@/lib/business/attachments";
import type { ChatAttachment, ChatMessage, ChatReaction } from "@/lib/business/chat";
import { getProjectRole, requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { CHAT_PAGE_SIZE } from "@/lib/business/chat";
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

/** Строка сообщения с вложенными реакциями и фото: так их отдаёт PostgREST. */
type MessageRow = {
  id: string;
  project_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  project_message_reactions: { user_id: string; emoji: string }[] | null;
  project_message_attachments:
    | { id: string; storage_path: string; width: number; height: number }[]
    | null;
};

function toMessage(row: MessageRow): ChatMessage {
  const { id, project_id, author_id, body, created_at, edited_at } = row;
  return { id, project_id, author_id, body, created_at, edited_at };
}

function toReactions(row: MessageRow): ChatReaction[] {
  return (row.project_message_reactions ?? []).map((reaction) => ({
    message_id: row.id,
    user_id: reaction.user_id,
    emoji: reaction.emoji,
  }));
}

/** Фото строки + ссылки, подписанные на весь список сообщений одним запросом. */
function toAttachments(row: MessageRow, urlByPath: Map<string, string>): ChatAttachment[] {
  return (row.project_message_attachments ?? []).map((attachment) => ({
    id: attachment.id,
    message_id: row.id,
    storage_path: attachment.storage_path,
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
export type ChatLoadResult =
  | { ok: true; messages: ChatMessage[]; reactions: ChatReaction[]; attachments: ChatAttachment[] }
  | { ok: false; error: string };

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

  const { data, error } = await supabase
    .from("project_messages")
    .insert({
      id: parsed.data.id,
      project_id: projectId,
      author_id: user.id,
      body: parsed.data.body,
    })
    .select("id, project_id, author_id, body, created_at, edited_at")
    .single();

  if (error || !data) {
    console.error("sendMessageAction:", error);
    return { ok: false, error: "Не удалось отправить сообщение. Попробуйте ещё раз." };
  }

  return { ok: true, message: data };
}

/** Последние сообщения и их реакции — для первого рендера и дозапроса после реконнекта. */
export async function loadMessagesAction(projectId: string): Promise<ChatLoadResult> {
  const role = await getProjectRole(projectId);
  if (!role) return { ok: false, error: "Нет доступа к проекту." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_messages")
    .select(
      "id, project_id, author_id, body, created_at, edited_at, project_message_reactions(user_id, emoji), project_message_attachments(id, storage_path, width, height)",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE_SIZE);

  if (error) {
    console.error("loadMessagesAction:", error);
    return { ok: false, error: "Не удалось загрузить чат." };
  }

  const rows = (data ?? []) as MessageRow[];
  const urlByPath = await signAttachments(supabase, rows);
  return {
    ok: true,
    messages: rows.map(toMessage).reverse(),
    reactions: rows.flatMap(toReactions),
    attachments: rows.flatMap((row) => toAttachments(row, urlByPath)),
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

const CHAT_UPLOAD_FAILED = "Не удалось загрузить фото. Попробуйте ещё раз.";

/**
 * Ссылка на загрузку одного фото. id сообщения генерирует клиент и присылает
 * заранее: путь должен содержать его, чтобы RLS Storage проверил проект.
 */
export async function startChatAttachmentUploadAction(
  projectId: string,
  messageId: string,
): Promise<ChatUploadStart> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  if (!chatEditSchema.shape.messageId.safeParse(messageId).success) {
    return { ok: false, error: CHAT_UPLOAD_FAILED };
  }

  const supabase = await createClient();
  const path = chatAttachmentPath(projectId, messageId, randomUUID());
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
  message_empty: "Добавьте текст или фото.",
  attachments_too_many: "К сообщению можно приложить не больше 4 фото.",
  attachment_path_mismatch: CHAT_UPLOAD_FAILED,
  attachments_invalid: CHAT_UPLOAD_FAILED,
};

/** Сообщение с фото: тела может не быть, размеры файлов берём из Storage, а не от клиента. */
export async function sendMessageWithAttachmentsAction(
  projectId: string,
  input: ChatMessageWithAttachmentsInput,
): Promise<ChatSendWithAttachmentsResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "Недостаточно прав." : denied.error };

  const parsed = chatMessageWithAttachmentsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Добавьте текст или фото — и не больше 4 фото." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Сессия истекла. Войдите заново." };

  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const folder = parsed.data.id.toLowerCase();
  const attachments: { path: string; width: number; height: number; size_bytes: number }[] = [];

  for (const attachment of parsed.data.attachments) {
    if (
      !isValidChatAttachmentPath(attachment.path, projectId, parsed.data.id) ||
      !isValidDimension(attachment.width) ||
      !isValidDimension(attachment.height)
    ) {
      return { ok: false, error: CHAT_UPLOAD_FAILED };
    }

    const prefix = chatAttachmentPath(projectId, parsed.data.id, "");
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

    attachments.push({
      path: attachment.path,
      width: attachment.width,
      height: attachment.height,
      size_bytes: size,
    });
  }

  const { data: message, error } = await supabase.rpc("create_chat_message", {
    p_project_id: projectId,
    p_id: parsed.data.id,
    p_body: parsed.data.body,
    p_attachments: attachments,
  });

  if (error || !message) {
    const known = Object.keys(RPC_ERRORS).find((code) => error?.message?.includes(code));
    console.error("sendMessageWithAttachmentsAction (rpc):", error);
    return { ok: false, error: known ? RPC_ERRORS[known] : CHAT_UPLOAD_FAILED };
  }

  const { data: rows, error: rowsError } = await supabase
    .from("project_message_attachments")
    .select("id, storage_path, width, height")
    .eq("message_id", parsed.data.id)
    .eq("project_id", projectId);

  if (rowsError) console.error("sendMessageWithAttachmentsAction (rows):", rowsError);

  const urlByPath = await signAttachments(
    supabase,
    (rows ?? []).map((row) => ({
      ...message,
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
      width: row.width,
      height: row.height,
      url: urlByPath.get(row.storage_path) ?? null,
    })),
  };
}
