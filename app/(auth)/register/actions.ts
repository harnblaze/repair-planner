"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { mapAuthError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { safeNextPath } from "@/lib/utils";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";

export async function registerAction(input: RegisterInput, next?: string): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  // При включённом подтверждении email адрес возврата уходит в письмо.
  // Ведём не сразу на нужную страницу, а на /auth/confirm: шаблон Supabase по
  // умолчанию возвращает PKCE-код (или токены во фрагменте), и сессию надо
  // поднять именно там. Адрес назначения передаём параметром next — страница
  // проверит, что это путь нашего же сайта.
  const target = safeNextPath(next);
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: origin
        ? `${origin}/auth/confirm?next=${encodeURIComponent(target)}`
        : undefined,
    },
  });

  if (error) {
    console.error("registerAction:", { code: error.code, status: error.status, message: error.message });
    return { ok: false, error: mapAuthError(error.message) };
  }

  // Если в проекте включено подтверждение email, signUp не создаёт сессию сразу.
  if (!data.session) {
    return {
      ok: true,
      message: "Мы отправили письмо со ссылкой для подтверждения email. Перейдите по ней, чтобы продолжить.",
    };
  }

  redirect(safeNextPath(next));
}
