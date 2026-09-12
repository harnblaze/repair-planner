import Link from "next/link";
import { notFound } from "next/navigation";

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
    <div className="flex flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">{project.name}</span>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href={`/${project.id}/tasks`} className="hover:underline">
            Заявки
          </Link>
          <Link href={`/${project.id}/categories`} className="hover:underline">
            Категории
          </Link>
          <Link href={`/${project.id}/executors`} className="hover:underline">
            Исполнители
          </Link>
          <Link href={`/${project.id}/materials`} className="hover:underline">
            Материалы
          </Link>
          <Link href={`/${project.id}/settings`} className="hover:underline">
            Настройки
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
