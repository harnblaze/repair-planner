"use server";

import type { ChatMessage, ChatReaction } from "@/lib/business/chat";
import { getProjectRole, requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { CHAT_PAGE_SIZE } from "@/lib/business/chat";
import {
  CHAT_BODY_MAX,
  chatEditSchema,
  chatMessageSchema,
  reactionSchema,
  type ChatMessageInput,
} from "@/lib/validation/chat";

// Мутации чата идут через серверные экшены, а не через браузерный клиент:
// браузерный клиент в проекте живёт только подпиской на Realtime.

const INVALID: { ok: false; error: string } = {
  ok: false,
  error: "Проверьте сообщение: оно не должно быть пустым и длиннее 2000 символов.",
};

/** Строка сообщения с вложенными реакциями: так их отдаёт PostgREST. */
type MessageRow = {
  id: string;
  project_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  project_message_reactions: { user_id: string; emoji: string }[] | null;
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

export type ChatSendResult = { ok: true; message: ChatMessage } | { ok: false; error: string };
export type ChatEditResult = { ok: true; message: ChatMessage } | { ok: false; error: string };
export type ChatDeleteResult = { ok: true } | { ok: false; error: string };
export type ChatLoadResult =
  | { ok: true; messages: ChatMessage[]; reactions: ChatReaction[] }
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
    .select("id, project_id, author_id, body, created_at, edited_at, project_message_reactions(user_id, emoji)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE_SIZE);

  if (error) {
    console.error("loadMessagesAction:", error);
    return { ok: false, error: "Не удалось загрузить чат." };
  }

  const rows = data ?? [];
  return {
    ok: true,
    messages: rows.map(toMessage).reverse(),
    reactions: rows.flatMap(toReactions),
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
