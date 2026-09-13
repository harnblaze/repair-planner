"use server";

import { revalidatePath } from "next/cache";

import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { executorSchema, type ExecutorInput } from "@/lib/validation/reference-data";

function revalidateExecutors(projectId: string) {
  revalidatePath(`/${projectId}/executors`);
}

export async function createExecutorAction(
  projectId: string,
  input: ExecutorInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = executorSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("executors").insert({
    project_id: projectId,
    name: parsed.data.name,
    position: parsed.data.position || null,
  });

  if (error) {
    console.error("createExecutorAction:", error);
    return { ok: false, error: "Не удалось добавить исполнителя. Попробуйте ещё раз." };
  }

  revalidateExecutors(projectId);
  return { ok: true };
}

export async function updateExecutorAction(
  projectId: string,
  executorId: string,
  input: ExecutorInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = executorSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("executors")
    .update({ name: parsed.data.name, position: parsed.data.position || null })
    .eq("id", executorId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateExecutorAction:", error);
    return { ok: false, error: "Не удалось сохранить исполнителя. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Исполнитель не найден." };
  }

  revalidateExecutors(projectId);
  return { ok: true };
}

export async function setExecutorActiveAction(
  projectId: string,
  executorId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("executors")
    .update({ is_active: isActive })
    .eq("id", executorId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("setExecutorActiveAction:", error);
    return { ok: false, error: "Не удалось изменить исполнителя. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Исполнитель не найден." };
  }

  revalidateExecutors(projectId);
  return { ok: true };
}
