"use server";

import { revalidatePath } from "next/cache";

import { testPushPayload } from "@/lib/business/push";
import { isPushConfigured, sendPush } from "@/lib/push/send";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { profileSchema, type ProfileInput } from "@/lib/validation/auth";
import { pushSubscriptionSchema, type PushSubscriptionInput } from "@/lib/validation/push";

export async function updateProfileAction(input: ProfileInput): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);

  if (error) {
    return { ok: false, error: "Не удалось сохранить профиль. Попробуйте ещё раз." };
  }

  revalidatePath("/profile");
  return { ok: true, message: "Профиль обновлён." };
}

// Уведомления на телефон. Подписка принадлежит устройству, поэтому строк в
// таблице может быть несколько; права — свои и только свои (миграция 0042).

export async function savePushSubscriptionAction(input: PushSubscriptionInput): Promise<ActionResult> {
  const parsed = pushSubscriptionSchema.safeParse(input);

  if (!parsed.success) {
    // Адрес устройства отбраковывается своим сообщением (allowlist хостов
    // push-сервисов); остальные поля — общей фразой, технический текст
    // пользователю не показываем.
    const endpointIssue = parsed.error.issues.find((issue) => issue.path[0] === "endpoint");
    return { ok: false, error: endpointIssue?.message ?? "Не удалось сохранить устройство. Попробуйте ещё раз." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  // Запись идёт через функцию: она же переносит подписку на нового владельца,
  // если на этом устройстве вошли под другим аккаунтом (0042).
  const { data, error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_user_agent: parsed.data.userAgent ?? undefined,
  });

  if (error || data !== true) {
    return { ok: false, error: "Не удалось сохранить устройство. Попробуйте ещё раз." };
  }

  return { ok: true };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  // RLS удаляет только свои строки: чужой endpoint молча ничего не удалит.
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);

  if (error) {
    return { ok: false, error: "Не удалось отключить уведомления. Попробуйте ещё раз." };
  }

  return { ok: true };
}

/** Тестовое уведомление на все устройства этого человека. */
export async function sendTestPushAction(): Promise<ActionResult> {
  if (!isPushConfigured()) {
    return { ok: false, error: "На сервере не заданы ключи уведомлений." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .order("created_at", { ascending: true });

  if (error) {
    return { ok: false, error: "Не удалось отправить уведомление. Попробуйте ещё раз." };
  }

  if (!subscriptions || subscriptions.length === 0) {
    return { ok: false, error: "Сначала включите уведомления на этом устройстве." };
  }

  const payload = testPushPayload();
  let sent = 0;
  const deadEndpoints: string[] = [];

  for (const subscription of subscriptions) {
    const result = await sendPush(
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
      payload,
    );
    if (result === "sent") sent += 1;
    if (result === "gone") deadEndpoints.push(subscription.endpoint);
  }

  // Мёртвые подписки убираем сразу: иначе они копятся и каждый пуш ждёт их ответа.
  if (deadEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  if (sent === 0) {
    return { ok: false, error: "Не удалось доставить уведомление. Проверьте разрешения в браузере." };
  }

  return { ok: true, message: sent > 1 ? `Отправлено на устройства: ${sent}` : "Уведомление отправлено." };
}
