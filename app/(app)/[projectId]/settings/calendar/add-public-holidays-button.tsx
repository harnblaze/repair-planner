"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { addPublicHolidaysAction } from "./actions";

export function AddPublicHolidaysButton({ projectId, year }: { projectId: string; year: number }) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const result = await addPublicHolidaysAction(projectId, year);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "Праздники добавлены.", { duration: 8000 });
      }
    });
  };

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClick} className="self-start">
      {pending ? "Добавление…" : `Добавить государственные праздники ${year} года`}
    </Button>
  );
}
