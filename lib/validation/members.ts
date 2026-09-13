import { z } from "zod";

import { INVITABLE_ROLES } from "@/lib/business/project-roles";

export const invitableRoleSchema = z.enum(INVITABLE_ROLES, { error: "Выберите роль" });

export const invitationSchema = z.object({
  role: invitableRoleSchema,
});

export type InvitationInput = z.infer<typeof invitationSchema>;

// Токен — 32 байта в base64url без выравнивания (supabase/migrations/0012).
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const uuidSchema = z.uuid();
