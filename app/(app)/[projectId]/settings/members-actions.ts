"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { mapInvitationError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import {
  invitableRoleSchema,
  invitationSchema,
  uuidSchema,
  type InvitationInput,
} from "@/lib/validation/members";

// Управление участниками. Права проверяет БД: RPC create_project_invitation и
// RLS project_members / project_invitations (supabase/migrations/0012). RLS не
// бросает ошибку на UPDATE/DELETE вне доступа, поэтому отсутствие затронутых
// строк переводится в понятное сообщение.

const OWNER_ONLY_MESSAGE = "Управлять участниками может только владелец проекта.";

function revalidateSettings(projectId: string) {
  revalidatePath(`/${projectId}/settings`);
}

export type CreateInvitationResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string };

export async function createInvitationAction(
  projectId: string,
  input: InvitationInput,
): Promise<CreateInvitationResult> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Выберите роль участника." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_project_invitation", { p_project_id: projectId, p_role: parsed.data.role })
    .single();

  if (error || !data) {
    console.error("createInvitationAction:", error);
    return { ok: false, error: mapInvitationError(error?.message) };
  }

  revalidateSettings(projectId);
  return { ok: true, token: data.token, expiresAt: data.expires_at };
}

export async function revokeInvitationAction(
  projectId: string,
  invitationId: string,
): Promise<ActionResult> {
  if (!uuidSchema.safeParse(invitationId).success) {
    return { ok: false, error: "Приглашение не найдено. Обновите страницу." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_invitations")
    .delete()
    .eq("id", invitationId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("revokeInvitationAction:", error);
    return { ok: false, error: "Не удалось отозвать приглашение. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Приглашение уже принято или отозвано. Обновите страницу." };
  }

  revalidateSettings(projectId);
  return { ok: true };
}

export async function updateMemberRoleAction(
  projectId: string,
  userId: string,
  role: string,
): Promise<ActionResult> {
  const parsedRole = invitableRoleSchema.safeParse(role);
  if (!parsedRole.success || !uuidSchema.safeParse(userId).success) {
    return { ok: false, error: "Выберите роль участника." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .update({ role: parsedRole.data })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    console.error("updateMemberRoleAction:", error);
    return { ok: false, error: "Не удалось изменить роль. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: OWNER_ONLY_MESSAGE };
  }

  revalidateSettings(projectId);
  return { ok: true };
}

export async function removeMemberAction(projectId: string, userId: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(userId).success) {
    return { ok: false, error: "Участник не найден. Обновите страницу." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    console.error("removeMemberAction:", error);
    return { ok: false, error: "Не удалось удалить участника. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: OWNER_ONLY_MESSAGE };
  }

  revalidateSettings(projectId);
  return { ok: true };
}

export async function leaveProjectAction(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .select("user_id");

  if (error) {
    console.error("leaveProjectAction:", error);
    return { ok: false, error: "Не удалось покинуть проект. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Владелец не может покинуть свой проект." };
  }

  revalidatePath("/projects");
  redirect("/projects");
}
