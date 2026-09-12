import { notFound } from "next/navigation";

import { ProjectNav } from "@/components/common/project-nav";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectLayout({ children, params }: LayoutProps<"/[projectId]">) {
  const { projectId } = await params;

  if (!UUID_RE.test(projectId)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .is("archived_at", null)
    .maybeSingle();

  // RLS уже ограничивает выборку проектами, к которым есть доступ — отсутствие
  // строки означает либо «не существует», либо «нет доступа», и намеренно не
  // различается (см. docs/architecture.md §4).
  if (!project) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-6 border-b border-line-strong bg-surface px-5">
        <span className="truncate text-[13px] font-semibold text-ink">{project.name}</span>
        <ProjectNav projectId={project.id} />
      </div>
      {children}
    </div>
  );
}
