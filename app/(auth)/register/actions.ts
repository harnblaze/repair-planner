"use server";

import { redirect } from "next/navigation";

import { mapAuthError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";

export async function registerAction(input: RegisterInput): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }

  // Если в проекте включено подтверждение email, signUp не создаёт сессию сразу.
  if (!data.session) {
    return {
      ok: true,
      message: "Подтвердите email по ссылке из письма, затем войдите.",
    };
  }

  redirect("/projects");
}
