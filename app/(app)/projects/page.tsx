import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Проекты — Repair Planner",
};

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, timezone")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 p-4 pt-16">
      <div className="flex flex-col gap-2">
        {projects && projects.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/${project.id}`}
                  className="block rounded-lg border border-border px-3 py-2 hover:bg-muted"
                >
                  <p className="font-medium">{project.name}</p>
                  <p className="text-sm text-muted-foreground">{project.timezone}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Пока нет ни одного проекта — создайте первый.
          </p>
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
