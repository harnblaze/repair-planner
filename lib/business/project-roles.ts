import type { Database } from "@/lib/types/database";

export type ProjectRole = Database["public"]["Enums"]["project_role"];

/** Роли, которые владелец может выдать участнику. owner не выдаётся. */
export const INVITABLE_ROLES = ["member", "viewer"] as const satisfies readonly ProjectRole[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Владелец",
  member: "Редактор",
  viewer: "Только просмотр",
};

export function projectRoleLabel(role: ProjectRole): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * Может ли роль менять данные проекта. Повторяет project_can_edit в БД
 * (supabase/migrations/0012) — там проверка обязательна, здесь только UX.
 */
export function canEditProject(role: ProjectRole | null | undefined): boolean {
  return role === "owner" || role === "member";
}

/** Настройки проекта, участники и приглашения — только владелец. */
export function canManageProject(role: ProjectRole | null | undefined): boolean {
  return role === "owner";
}

/** Приглашение истекло — то же условие, что в accept_project_invitation. */
export function isInvitationExpired(expiresAt: string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
