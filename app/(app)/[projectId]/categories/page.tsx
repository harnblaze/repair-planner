import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { CategoryRow } from "./category-row";
import { CreateCategoryForm } from "./create-category-form";

export const metadata: Metadata = {
  title: "Категории — Repair Planner",
};

export default async function CategoriesPage({ params }: PageProps<"/[projectId]/categories">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq("project_id", projectId)
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true });

  const active = categories?.filter((c) => !c.is_archived) ?? [];
  const archived = categories?.filter((c) => c.is_archived) ?? [];

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Категории</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateCategoryForm projectId={projectId} />

          <div className="flex flex-col divide-y divide-border">
            {active.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Пока нет ни одной категории.</p>
            ) : (
              active.map((category) => (
                <CategoryRow key={category.id} projectId={projectId} category={category} />
              ))
            )}
          </div>

          {archived.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Архивные ({archived.length})
              </summary>
              <div className="flex flex-col divide-y divide-border pt-2">
                {archived.map((category) => (
                  <CategoryRow key={category.id} projectId={projectId} category={category} />
                ))}
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
