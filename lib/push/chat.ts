import { after } from "next/server";

import { chatPushPayload } from "@/lib/business/push";
import { isPushConfigured, sendPush } from "@/lib/push/send";
import type { createClient } from "@/lib/supabase/server";

// Рассылка уведомлений о новом сообщении в чате.
//
// Два шага намеренно разделены:
//  • подготовка (список подписок и имя автора) — в самом запросе: без неё
//    отправлять нечего, а ошибка чтения не должна молча съедаться;
//  • отправка — в after(), уже после ответа браузеру: человек не ждёт, пока
//    push-сервисы ответят, а сбой доставки не превращает отправку сообщения
//    в ошибку.
//
// Никакого service-role: подписки участников отдаёт функция с проверкой
// членства (0043), а мёртвые строки убирает тоже функция.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const FALLBACK_AUTHOR = "Сообщение в чате";

export async function scheduleChatPush(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    authorId: string;
    body: string;
    hasAttachments: boolean;
  },
): Promise<void> {
  if (!isPushConfigured()) return;

  const [subscriptionsResult, authorResult] = await Promise.all([
    supabase.rpc("project_push_subscriptions", { p_project_id: input.projectId }),
    supabase.from("profiles").select("full_name").eq("id", input.authorId).maybeSingle(),
  ]);

  if (subscriptionsResult.error) {
    console.error("scheduleChatPush (subscriptions):", subscriptionsResult.error);
    return;
  }

  // Автору своё же сообщение не показываем: он его только что написал.
  const targets = (subscriptionsResult.data ?? []).filter(
    (row) => row.user_id !== input.authorId,
  );
  if (targets.length === 0) return;

  const authorName = authorResult.data?.full_name?.trim() || FALLBACK_AUTHOR;
  const payload = chatPushPayload({
    authorName,
    body: input.body,
    projectId: input.projectId,
    hasAttachments: input.hasAttachments,
  });

  after(async () => {
    const dead: string[] = [];

    for (const target of targets) {
      const result = await sendPush(
        { endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth },
        payload,
      );
      if (result === "gone") dead.push(target.endpoint);
    }

    if (dead.length > 0) {
      const { error } = await supabase.rpc("prune_push_subscriptions", { p_endpoints: dead });
      if (error) console.error("scheduleChatPush (prune):", error);
    }
  });
}
