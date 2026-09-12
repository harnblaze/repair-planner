import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { CreateExecutorForm } from "./create-executor-form";
import { ExecutorRow } from "./executor-row";

export const metadata: Metadata = {
  title: "Исполнители — Repair Planner",
};

export default async function ExecutorsPage({ params }: PageProps<"/[projectId]/executors">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: executors } = await supabase
    .from("executors")
    .select("id, name, position, is_active")
    .eq("project_id", projectId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  const active = executors?.filter((e) => e.is_active) ?? [];
  const inactive = executors?.filter((e) => !e.is_active) ?? [];

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Исполнители</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateExecutorForm projectId={projectId} />

          <div className="flex flex-col divide-y divide-border">
            {active.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Пока нет ни одного исполнителя.</p>
            ) : (
              active.map((executor) => (
                <ExecutorRow key={executor.id} projectId={projectId} executor={executor} />
              ))
            )}
          </div>

          {inactive.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Неактивные ({inactive.length})
              </summary>
              <div className="flex flex-col divide-y divide-border pt-2">
                {inactive.map((executor) => (
                  <ExecutorRow key={executor.id} projectId={projectId} executor={executor} />
                ))}
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
