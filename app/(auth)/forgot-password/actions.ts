"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/auth";

// Сообщение одинаково при успехе и при отсутствии такого email —
// иначе форма превращается в способ проверить, зарегистрирован ли email.
const SUCCESS_MESSAGE =
  "Если такой email зарегистрирован, на него отправлено письмо со ссылкой для восстановления пароля.";

export async function forgotPasswordAction(input: ForgotPasswordInput): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  return { ok: true, message: SUCCESS_MESSAGE };
}
