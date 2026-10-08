"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { cleanupAttachmentOrphans } from "@/lib/attachments/cleanup";
import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENTS_PER_TASK,
  attachmentFolder,
  buildAttachmentPath,
  isValidAttachmentPath,
  isValidDimension,
} from "@/lib/business/attachments";
import { ATTACHMENT_MESSAGES, isUniqueViolation } from "@/lib/errors";
import { NO_EDIT_ACCESS_MESSAGE, requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";

// Загрузка фото в три шага (docs/superpowers/specs/2026-10-07-task-attachments-design.md §4):
// сервер выдаёт ссылку на свой путь → браузер кладёт байты прямо в Storage →
// сервер проверяет объект и записывает строку. Права проверяют RLS таблицы
// и RLS storage.objects; service role не используется.

export type StartUploadResult =
  | { ok: true; path: string; signedUrl: string }
  | { ok: false; error: string };

export async function startTaskAttachmentUploadAction(
  projectId: string,
  taskId: string,
): Promise<StartUploadResult> {
  if (await requireProjectEdit(projectId)) {
    return { ok: false, error: NO_EDIT_ACCESS_MESSAGE };
  }

  const supabase = await createClient();
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (taskError) {
    console.error("startTaskAttachmentUploadAction (task):", taskError);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }
  if (!task) {
    return { ok: false, error: ATTACHMENT_MESSAGES.taskNotFound };
  }

  // Лимит мягкий: две одновременные загрузки могут дать на одно фото больше.
  const { count, error: countError } = await supabase
    .from("task_attachments")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("project_id", projectId);

  if (countError) {
    console.error("startTaskAttachmentUploadAction (count):", countError);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_TASK) {
    return { ok: false, error: ATTACHMENT_MESSAGES.limitReached };
  }

  const path = buildAttachmentPath(projectId, taskId, randomUUID());
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("startTaskAttachmentUploadAction (sign):", error);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }

  return { ok: true, path, signedUrl: data.signedUrl };
}

export async function confirmTaskAttachmentAction(
  projectId: string,
  taskId: string,
  path: string,
  width: number,
  height: number,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!isValidAttachmentPath(path, projectId, taskId) || !isValidDimension(width) || !isValidDimension(height)) {
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }

  const supabase = await createClient();
  const bucket = supabase.storage.from(ATTACHMENTS_BUCKET);
  const folder = attachmentFolder(projectId, taskId);
  const fileName = path.slice(folder.length + 1);

  // Размер берётся из метаданных Storage, а не от клиента.
  const { data: objects, error: listError } = await bucket.list(folder, { search: fileName, limit: 1 });
  const object = objects?.find((o) => o.name === fileName);
  const size = Number(object?.metadata?.size);

  if (listError || !object || !(size > 0)) {
    console.error("confirmTaskAttachmentAction (object not found):", listError ?? path);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }

  const { error } = await supabase.from("task_attachments").insert({
    project_id: projectId,
    task_id: taskId,
    storage_path: path,
    size_bytes: size,
    width,
    height,
  });

  if (error) {
    // Повторное подтверждение того же пути (двойной клик, повтор после
    // таймаута): строка уже есть — это успех, файл удалять нельзя.
    if (!isUniqueViolation(error)) {
      console.error("confirmTaskAttachmentAction (insert):", error);
      const { error: removeError } = await bucket.remove([path]);
      if (removeError) console.error("confirmTaskAttachmentAction (cleanup):", removeError);
      return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
    }
  }

  // Фоном после ответа: файлы-«сироты» проекта старше суток (0026). Сбой
  // очистки только логируется и на загрузку не влияет.
  after(() => cleanupAttachmentOrphans(supabase, projectId));

  revalidatePath(`/${projectId}/tasks/${taskId}`);
  return { ok: true };
}

export async function deleteTaskAttachmentAction(
  projectId: string,
  taskId: string,
  attachmentId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  // Путь к файлу — из удалённой строки, клиенту не доверяем. Сначала строка:
  // при сбое Storage остаётся невидимая «сирота», а не битая миниатюра.
  const { data, error } = await supabase
    .from("task_attachments")
    .delete()
    .eq("id", attachmentId)
    .eq("task_id", taskId)
    .eq("project_id", projectId)
    .select("storage_path");

  if (error) {
    console.error("deleteTaskAttachmentAction:", error);
    return { ok: false, error: ATTACHMENT_MESSAGES.deleteFailed };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: ATTACHMENT_MESSAGES.notFound };
  }

  const { error: removeError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([data[0].storage_path]);
  if (removeError) {
    console.error("deleteTaskAttachmentAction (storage, orphan left):", removeError);
  }

  revalidatePath(`/${projectId}/tasks/${taskId}`);
  return { ok: true };
}
