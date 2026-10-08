import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { taskStatusLabel } from "@/lib/business/task-status";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { ArchiveTab } from "./archive-tab";
import { CreateTaskForm } from "./create-task-form";

export const metadata: Metadata = {
  title: "Заявки — Repair Planner",
};

// Сегменты как у переключателя недели на доске (docs/redesign.md §3).
const TAB_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium whitespace-nowrap text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink";
const TAB_ACTIVE_CLASS = "bg-brand-surface text-brand hover:bg-brand-surface hover:text-brand";

export default async function TasksPage({ params, searchParams }: PageProps<"/[projectId]/tasks">) {
  const { projectId } = await params;
  const query = await searchParams;
  const isArchive = query.view === "archive";
  const base = `/${projectId}/tasks`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader>
          <CardTitle>Заявки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <nav
            aria-label="Заявки"
            className="flex self-start overflow-hidden rounded-[7px] border border-control bg-surface"
          >
            <Link
              href={base}
              aria-current={isArchive ? undefined : "page"}
              className={cn(TAB_CLASS, !isArchive && TAB_ACTIVE_CLASS)}
            >
              Открытые
            </Link>
            <Link
              href={`${base}?view=archive`}
              aria-current={isArchive ? "page" : undefined}
              className={cn(TAB_CLASS, isArchive && TAB_ACTIVE_CLASS)}
            >
              Архив
            </Link>
          </nav>
          {isArchive ? (
            <ArchiveTab projectId={projectId} searchParams={query} />
          ) : (
            <OpenTasks projectId={projectId} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

async function OpenTasks({ projectId }: { projectId: string }) {
  const supabase = await createClient();
  const [role, { data: tasks }, { data: categories }, { data: queues }] = await Promise.all([
    getProjectRole(projectId),
    supabase
      .from("tasks")
      .select("id, title, status, categories(name)")
      .eq("project_id", projectId)
      // Выполненные и отменённые — во вкладке «Архив».
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true }),
    supabase
      .from("task_queues")
      .select("id, name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  const open = tasks ?? [];

  return (
    <>
      {canEditProject(role) ? (
        <CreateTaskForm projectId={projectId} categories={categories ?? []} queues={queues ?? []} />
      ) : null}

      <div className="flex flex-col divide-y divide-line-subtle">
        {open.length === 0 ? (
          <EmptyState>Открытых заявок нет.</EmptyState>
        ) : (
          open.map((task) => (
            <Link
              key={task.id}
              href={`/${projectId}/tasks/${task.id}`}
              className="flex items-center justify-between gap-2 py-2 hover:bg-row-hover"
            >
              <span>{task.title}</span>
              <span className="flex items-center gap-2 text-[12px] text-meta">
                {task.categories ? <span>{task.categories.name}</span> : null}
                <span>{taskStatusLabel(task.status)}</span>
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
