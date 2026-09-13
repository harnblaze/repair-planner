import type { Metadata } from "next";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import { CategoryRow } from "./category-row";
import { CreateCategoryForm } from "./create-category-form";

export const metadata: Metadata = {
  title: "Категории — Repair Planner",
};

export default async function CategoriesPage({ params }: PageProps<"/[projectId]/categories">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const canEdit = canEditProject(await getProjectRole(projectId));
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq("project_id", projectId)
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true });

  const active = categories?.filter((c) => !c.is_archived) ?? [];
  const archived = categories?.filter((c) => c.is_archived) ?? [];

  return (
    <main className="mx-auto flex max-w-sm w-full flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader>
          <CardTitle>Категории</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canEdit ? <CreateCategoryForm projectId={projectId} /> : null}

          <div className="flex flex-col divide-y divide-line-subtle">
            {active.length === 0 ? (
              <EmptyState>Пока нет ни одной категории.</EmptyState>
            ) : (
              active.map((category) => (
                <CategoryRow key={category.id} projectId={projectId} category={category} canEdit={canEdit} />
              ))
            )}
          </div>

          {archived.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-[12px] text-meta">
                Архивные ({archived.length})
              </summary>
              <div className="flex flex-col divide-y divide-line-subtle pt-2">
                {archived.map((category) => (
                  <CategoryRow key={category.id} projectId={projectId} category={category} canEdit={canEdit} />
                ))}
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
