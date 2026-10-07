import { notFound } from "next/navigation";

import { ProjectNav } from "@/components/common/project-nav";
import { BADGE_BASE } from "@/components/common/status-badge";
import { canEditProject, projectRoleLabel } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectLayout({ children, params }: LayoutProps<"/[projectId]">) {
  const { projectId } = await params;

  if (!UUID_RE.test(projectId)) {
    notFound();
  }

  const supabase = await createClient();
  const [{ data: project }, role] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .is("archived_at", null)
      .maybeSingle(),
    getProjectRole(projectId),
  ]);

  // RLS уже ограничивает выборку проектами, к которым есть доступ — отсутствие
  // строки означает либо «не существует», либо «нет доступа», и намеренно не
  // различается (см. docs/architecture.md §4).
  if (!project) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* До md навигация не помещается рядом с названием — уходит второй строкой. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-line-strong bg-surface px-5 pt-2 pb-1.5 md:h-11 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{project.name}</span>
          {/* Роль в проекте — повод, почему нет кнопок редактирования. */}
          {role && !canEditProject(role) ? (
            <span className={`${BADGE_BASE} bg-page text-meta`}>{projectRoleLabel(role)}</span>
          ) : null}
        </div>
        <ProjectNav projectId={project.id} />
      </div>
      {children}
    </div>
  );
}
