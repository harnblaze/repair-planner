"use server";

import { mapAuthError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation/auth";

export async function resetPasswordAction(input: ResetPasswordInput): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }

  // Разлогиниваем: recovery-сессия не должна автоматически пускать в приложение,
  // пользователь входит заново с новым паролем осознанно.
  await supabase.auth.signOut();

  return { ok: true, message: "Пароль изменён. Войдите с новым паролем." };
}
