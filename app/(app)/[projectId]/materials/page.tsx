import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { CreateMaterialForm } from "./create-material-form";
import { MaterialRow } from "./material-row";

export const metadata: Metadata = {
  title: "Материалы — Repair Planner",
};

export default async function MaterialsPage({ params }: PageProps<"/[projectId]/materials">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: materials } = await supabase
    .from("materials")
    .select("id, name, unit, current_balance, minimum_balance, is_active")
    .eq("project_id", projectId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  const active = materials?.filter((m) => m.is_active) ?? [];
  const inactive = materials?.filter((m) => !m.is_active) ?? [];

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Материалы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateMaterialForm projectId={projectId} />

          <div className="flex flex-col divide-y divide-border">
            {active.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Пока нет ни одного материала.</p>
            ) : (
              active.map((material) => (
                <MaterialRow key={material.id} projectId={projectId} material={material} />
              ))
            )}
          </div>

          {inactive.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Неактивные ({inactive.length})
              </summary>
              <div className="flex flex-col divide-y divide-border pt-2">
                {inactive.map((material) => (
                  <MaterialRow key={material.id} projectId={projectId} material={material} />
                ))}
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
