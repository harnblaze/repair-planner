import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { projectRoleLabel } from "@/lib/business/project-roles";
import { createClient } from "@/lib/supabase/server";

import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Проекты — Repair Planner",
};

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Встроенный фильтр ограничивает project_members строкой текущего пользователя —
  // так видна его роль в каждом проекте.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, timezone, project_members(role)")
    .eq("project_members.user_id", user?.id ?? "")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex max-w-sm w-full flex-col gap-6 px-5 pt-6 pb-7">
      <div className="flex flex-col gap-2">
        {projects && projects.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/${project.id}`}
                  className="block rounded-lg border border-line-strong px-3 py-2 hover:bg-row-hover"
                >
                  <p className="font-medium">{project.name}</p>
                  <p className="text-[12px] text-meta">
                    {project.timezone}
                    {project.project_members[0] && project.project_members[0].role !== "owner"
                      ? ` · ${projectRoleLabel(project.project_members[0].role)}`
                      : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Пока нет ни одного проекта — создайте первый.</EmptyState>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Новый проект</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateProjectForm />
        </CardContent>
      </Card>
    </main>
  );
}
