"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { projectSchema, type ProjectInput } from "@/lib/validation/project";

export async function updateProjectAction(
  projectId: string,
  input: ProjectInput,
): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ name: parsed.data.name, timezone: parsed.data.timezone })
    .eq("id", projectId)
    .select("id");

  // RLS не бросает ошибку при обновлении вне доступа — просто не находит строк.
  // Различаем «нет доступа» от реальной ошибки явной проверкой количества строк.
  if (error) {
    return { ok: false, error: "Не удалось сохранить настройки. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Изменять настройки может только владелец проекта." };
  }

  revalidatePath(`/${projectId}`);
  revalidatePath(`/${projectId}/settings`);
  revalidatePath("/projects");
  return { ok: true, message: "Настройки сохранены." };
}
