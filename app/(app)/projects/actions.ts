"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ATTACHMENTS_BUCKET } from "@/lib/business/attachments";
import { confirmsProjectName } from "@/lib/business/project-archive";
import { PROJECT_MESSAGES } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { uuidSchema } from "@/lib/validation/members";
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

// Архив и удаление (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md §5).
// Права гарантирует RLS (projects_update / projects_delete — только владелец,
// удаление — только архивного); 0 изменённых строк = нет прав, если проект
// уже не в нужном состоянии (иначе это повтор из второй вкладки — успех).

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Защита от бесконечного цикла: 100 пачек по 1000 файлов. */
const MAX_FILE_BATCHES = 100;

export async function archiveProjectAction(projectId: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: PROJECT_MESSAGES.notFound };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId)
    .is("archived_at", null)
    .select("id");

  if (error) {
    console.error("archiveProjectAction:", error);
    return { ok: false, error: PROJECT_MESSAGES.archiveFailed };
  }
  if ((!data || data.length === 0) && (await isArchived(supabase, projectId)) !== true) {
    return { ok: false, error: PROJECT_MESSAGES.ownerOnly };
  }

  revalidatePath("/projects");
  redirect("/projects");
}

export async function restoreProjectAction(projectId: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: PROJECT_MESSAGES.notFound };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: null })
    .eq("id", projectId)
    .not("archived_at", "is", null)
    .select("id");

  if (error) {
    console.error("restoreProjectAction:", error);
    return { ok: false, error: PROJECT_MESSAGES.restoreFailed };
  }
  if ((!data || data.length === 0) && (await isArchived(supabase, projectId)) !== false) {
    return { ok: false, error: PROJECT_MESSAGES.ownerOnly };
  }

  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProjectAction(projectId: string, confirmName: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: PROJECT_MESSAGES.notFound };

  const supabase = await createClient();
  const { data: project, error: readError } = await supabase
    .from("projects")
    .select("name, archived_at")
    .eq("id", projectId)
    .maybeSingle();

  if (readError) {
    console.error("deleteProjectAction (read):", readError);
    return { ok: false, error: PROJECT_MESSAGES.deleteFailed };
  }
  if (!project || !project.archived_at) return { ok: false, error: PROJECT_MESSAGES.notArchived };
  if (!confirmsProjectName(String(confirmName ?? ""), project.name)) {
    return { ok: false, error: PROJECT_MESSAGES.nameMismatch };
  }

  // Сначала файлы: после удаления строки проекта RLS storage.objects их не отдаст.
  // Если часть фото уже удалена, мастер должен повторить удаление, а не вернуть
  // проект с битыми миниатюрами.
  const files = await removeProjectFiles(supabase, projectId);
  const failed = files.removedAny ? PROJECT_MESSAGES.deletePartial : PROJECT_MESSAGES.deleteFailed;
  if (!files.ok) return { ok: false, error: failed };

  const { data, error } = await supabase.from("projects").delete().eq("id", projectId).select("id");
  if (error) {
    console.error("deleteProjectAction (delete):", error);
    return { ok: false, error: failed };
  }
  if (!data || data.length === 0) return { ok: false, error: PROJECT_MESSAGES.ownerOnly };

  revalidatePath("/projects");
  return { ok: true };
}

/** Состояние архива проекта: true/false; null — проект не виден или ошибка чтения. */
async function isArchived(supabase: Supabase, projectId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from("projects").select("archived_at").eq("id", projectId).maybeSingle();
  if (error) console.error("isArchived:", error);
  return data ? data.archived_at !== null : null;
}

/**
 * Удаляет все файлы архивного проекта пачками. ok: false — остановлено, проект
 * трогать нельзя; removedAny — часть файлов уже удалена.
 */
async function removeProjectFiles(
  supabase: Supabase,
  projectId: string,
): Promise<{ ok: boolean; removedAny: boolean }> {
  const bucket = supabase.storage.from(ATTACHMENTS_BUCKET);
  let removedAny = false;

  for (let batch = 0; batch < MAX_FILE_BATCHES; batch++) {
    const { data: paths, error } = await supabase.rpc("project_attachment_paths", { p_project_id: projectId });
    if (error) {
      console.error("deleteProjectAction (paths):", error);
      return { ok: false, removedAny };
    }
    if (!paths || paths.length === 0) return { ok: true, removedAny };

    const { data: removed, error: removeError } = await bucket.remove(paths);
    if ((removed?.length ?? 0) > 0) removedAny = true;
    if (removeError || (removed?.length ?? 0) < paths.length) {
      console.error("deleteProjectAction (storage):", removeError ?? `removed ${removed?.length ?? 0} of ${paths.length}`);
      return { ok: false, removedAny };
    }
  }

  console.error("deleteProjectAction: too many file batches", projectId);
  return { ok: false, removedAny };
}
