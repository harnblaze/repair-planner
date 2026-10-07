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
  // При включённом подтверждении email next (например, ссылка-приглашение)
  // возвращается через письмо: шаблон supabase/templates/confirmation.html.
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: origin ? `${origin}${safeNextPath(next)}` : undefined,
    },
  });

  if (error) {
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
