"use server";

import { redirect } from "next/navigation";

import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

export async function createTaskAction(
  projectId: string,
  input: CreateTaskInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = createTaskSchema.safeParse(input);

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

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      project_id: projectId,
      title: parsed.data.title,
      category_id: parsed.data.categoryId || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !task) {
    console.error("createTaskAction:", error);
    return { ok: false, error: "Не удалось создать заявку. Попробуйте ещё раз." };
  }

  redirect(`/${projectId}/tasks/${task.id}`);
}
