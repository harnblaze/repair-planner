"use server";

import type { ChatMessage } from "@/lib/business/chat";
import { getProjectRole, requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { CHAT_PAGE_SIZE } from "@/lib/business/chat";
import { CHAT_BODY_MAX, chatMessageSchema, type ChatMessageInput } from "@/lib/validation/chat";

// Мутации чата идут через серверные экшены, а не через браузерный клиент:
// браузерный клиент в проекте живёт только подпиской на Realtime.

const INVALID: { ok: false; error: string } = {
  ok: false,
  error: "Проверьте сообщение: оно не должно быть пустым и длиннее 2000 символов.",
};

export type ChatSendResult = { ok: true; message: ChatMessage } | { ok: false; error: string };
export type ChatLoadResult = { ok: true; messages: ChatMessage[] } | { ok: false; error: string };

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
    .select("id, project_id, author_id, body, created_at")
    .single();

  if (error || !data) {
    console.error("sendMessageAction:", error);
    return { ok: false, error: "Не удалось отправить сообщение. Попробуйте ещё раз." };
  }

  return { ok: true, message: data };
}

/** Последние сообщения — для первого рендера и для дозапроса после реконнекта. */
export async function loadMessagesAction(projectId: string): Promise<ChatLoadResult> {
  const role = await getProjectRole(projectId);
  if (!role) return { ok: false, error: "Нет доступа к проекту." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_messages")
    .select("id, project_id, author_id, body, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE_SIZE);

  if (error) {
    console.error("loadMessagesAction:", error);
    return { ok: false, error: "Не удалось загрузить чат." };
  }

  return { ok: true, messages: (data ?? []).reverse() };
}

/** Отметка «прочитано до»: по ней считается непрочитанное. */
export async function markChatReadAction(projectId: string): Promise<{ ok: boolean }> {
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
