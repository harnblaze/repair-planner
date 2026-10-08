"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmsProjectName } from "@/lib/business/project-archive";

import { deleteProjectAction, restoreProjectAction } from "./actions";

export type ArchivedProject = { id: string; name: string };

/** Архивные проекты владельца: вернуть или удалить навсегда (spec 2026-10-08 §3). */
export function ArchivedProjects({ projects }: { projects: ArchivedProject[] }) {
  if (projects.length === 0) return null;

  return (
    <details className="flex flex-col">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-meta select-none">
        Архив ({projects.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {projects.map((project) => (
          <ArchivedProjectRow key={project.id} project={project} />
        ))}
      </ul>
    </details>
  );
}

function ArchivedProjectRow({ project }: { project: ArchivedProject }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmed = confirmsProjectName(typed, project.name);
  const inputId = `delete-confirm-${project.id}`;

  const restore = () => {
    startTransition(async () => {
      const result = await restoreProjectAction(project.id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Проект возвращён из архива.");
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteProjectAction(project.id, typed);
      if (!result.ok) toast.error(result.error);
      else toast.success("Проект удалён.");
    });
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line-strong px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-medium text-ink-muted">{project.name}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="xs" disabled={pending} onClick={restore}>
            Вернуть
          </Button>
          <Button
            variant="destructive"
            size="xs"
            disabled={pending}
            aria-expanded={confirming}
            aria-controls={inputId}
            onClick={() => {
              setConfirming((open) => !open);
              setTyped("");
            }}
          >
            Удалить навсегда
          </Button>
        </div>
      </div>

      {confirming ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed) remove();
          }}
        >
          <Label htmlFor={inputId} className="text-[12px] font-normal text-status-alert-fg">
            Будут удалены все заявки, материалы, списки и фото проекта. Это необратимо. Введите название
            проекта:
          </Label>
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            disabled={pending}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button type="submit" variant="destructive" size="sm" className="self-start" disabled={pending || !confirmed}>
            Удалить навсегда
          </Button>
        </form>
      ) : null}
    </li>
  );
}
