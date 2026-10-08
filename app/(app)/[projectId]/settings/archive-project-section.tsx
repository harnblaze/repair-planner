"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { archiveProjectAction } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";

export function ArchiveProjectSection({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  const archive = () => {
    if (!window.confirm("Отправить проект в архив? Он пропадёт у всех участников.")) return;
    startTransition(async () => {
      // При успехе действие делает redirect() на список проектов.
      const result = await archiveProjectAction(projectId);
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-muted">
        Проект пропадёт у всех участников. Данные сохранятся — вернуть проект можно в разделе «Архив»
        списка проектов.
      </p>
      <Button variant="outline" size="sm" className="self-start" disabled={pending} onClick={archive}>
        Отправить в архив
      </Button>
    </div>
  );
}
