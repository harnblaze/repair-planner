"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

// В отличие от app/(app)/[projectId]/tasks/actions.ts::createTaskAction, здесь
// нет редиректа на карточку — задача создаётся прямо с доски и сразу видна
// в «Текущих заявках», без переключения между страницами.
export async function createTaskFromBoardAction(
  projectId: string,
  input: CreateTaskInput,
): Promise<ActionResult> {
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

  const { error } = await supabase.from("tasks").insert({
    project_id: projectId,
    title: parsed.data.title,
    category_id: parsed.data.categoryId || null,
    created_by: user.id,
  });

  if (error) {
    console.error("createTaskFromBoardAction:", error);
    return { ok: false, error: "Не удалось создать заявку. Попробуйте ещё раз." };
  }

  revalidatePath(`/${projectId}/board`);
  revalidatePath(`/${projectId}/tasks`);
  return { ok: true };
}
