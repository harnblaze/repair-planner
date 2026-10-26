import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ui/card";
import { isMaterialInOrder, isOrderList } from "@/lib/business/order-list";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import { MaterialsList } from "./materials-list";

export const metadata: Metadata = {
  title: "Материалы — Планировщик",
};

async function loadOpenOrderTitles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string[]> {
  const { data: lists } = await supabase
    .from("board_lists")
    .select("id, name, is_system")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("created_at");
  const list = (lists ?? []).find((l) => isOrderList(l.name, l.is_system));
  if (!list) return [];

  const { data: items } = await supabase
    .from("board_items")
    .select("title")
    .eq("project_id", projectId)
    .eq("list_id", list.id)
    .eq("is_done", false);
  return (items ?? []).map((item) => item.title);
}

export default async function MaterialsPage({ params }: PageProps<"/[projectId]/materials">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const canEdit = canEditProject(await getProjectRole(projectId));
  const [{ data: materials }, openOrderTitles] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name, unit, current_balance, minimum_balance, is_active")
      .eq("project_id", projectId)
      .order("name", { ascending: true }),
    canEdit ? loadOpenOrderTitles(supabase, projectId) : Promise.resolve<string[]>([]),
  ]);
  // Материалы, уже стоящие в списке «Материалы к заказу» невыполненным пунктом.
  const inOrderIds = (materials ?? [])
    .filter((material) => isMaterialInOrder(material.name, openOrderTitles))
    .map((material) => material.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardContent>
          <MaterialsList projectId={projectId} materials={materials ?? []} canEdit={canEdit} inOrderIds={inOrderIds} />
        </CardContent>
      </Card>
    </main>
  );
}
