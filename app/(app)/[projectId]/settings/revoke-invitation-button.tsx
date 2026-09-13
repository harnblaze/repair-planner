"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { revokeInvitationAction } from "./members-actions";

export function RevokeInvitationButton({
  projectId,
  invitationId,
}: {
  projectId: string;
  invitationId: string;
}) {
  const [pending, startTransition] = useTransition();

  const revoke = () => {
    startTransition(async () => {
      const result = await revokeInvitationAction(projectId, invitationId);
      if (!result.ok) toast.error(result.error);
      else toast.success("Приглашение отозвано.");
    });
  };

  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={revoke}>
      Отозвать
    </Button>
  );
}
