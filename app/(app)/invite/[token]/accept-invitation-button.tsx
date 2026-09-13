"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { acceptInvitationAction } from "./actions";

export function AcceptInvitationButton({ token, label }: { token: string; label: string }) {
  const [pending, startTransition] = useTransition();

  const accept = () => {
    startTransition(async () => {
      const result = await acceptInvitationAction(token);
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <Button type="button" disabled={pending} onClick={accept} className="self-start">
      {pending ? "Подождите…" : label}
    </Button>
  );
}
