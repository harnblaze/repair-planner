"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { mapInvitationError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { invitationTokenSchema } from "@/lib/validation/members";

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  if (!invitationTokenSchema.safeParse(token).success) {
    return { ok: false, error: mapInvitationError("invitation_not_found") };
  }

  const supabase = await createClient();
  const { data: projectId, error } = await supabase.rpc("accept_project_invitation", {
    p_token: token,
  });

  if (error || !projectId) {
    console.error("acceptInvitationAction:", error?.message);
    return { ok: false, error: mapInvitationError(error?.message) };
  }

  revalidatePath("/projects");
  redirect(`/${projectId}/board`);
}
