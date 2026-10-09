import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import { MaterialsList } from "./materials-list";

export const metadata: Metadata = {
  title: "Материалы — Планировщик",
};

export default async function MaterialsPage({ params }: PageProps<"/[projectId]/materials">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const canEdit = canEditProject(await getProjectRole(projectId));
  const { data: materials } = await supabase
    .from("materials")
    .select("id, name, unit, current_balance, minimum_balance, is_active")
    .eq("project_id", projectId)
    .order("name", { ascending: true });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardContent>
          <MaterialsList projectId={projectId} materials={materials ?? []} canEdit={canEdit} />
        </CardContent>
      </Card>
    </main>
  );
}
