"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { projectSchema, type ProjectInput } from "@/lib/validation/project";

export async function createProjectAction(input: ProjectInput): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);

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

  const { data: project, error } = await supabase
    .from("projects")
    .insert({ name: parsed.data.name, timezone: parsed.data.timezone, owner_id: user.id })
    .select("id")
    .single();

  if (error || !project) {
    console.error("createProjectAction:", error);
    return { ok: false, error: "Не удалось создать проект. Попробуйте ещё раз." };
  }

  redirect(`/${project.id}`);
}
