import { todayInTimezone } from "@/lib/business/dates";
import { createClient } from "@/lib/supabase/server";
import { parseArchiveFilters } from "@/lib/validation/archive-filters";

import { loadArchive } from "./archive-data";
import { ArchiveFiltersForm } from "./archive-filters-form";
import { ArchiveList } from "./archive-list";

export async function ArchiveTab({
  projectId,
  searchParams,
}: {
  projectId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseArchiveFilters(searchParams);
  const supabase = await createClient();

  // Справочники — вместе с архивными: старая работа делалась старыми цехами и людьми.
  const [{ data: project }, { data: categories }, { data: executors }, result] = await Promise.all([
    supabase.from("projects").select("timezone").eq("id", projectId).maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, is_archived")
      .eq("project_id", projectId)
      .order("is_archived", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("executors")
      .select("id, name, is_active")
      .eq("project_id", projectId)
      .order("is_active", { ascending: false })
      .order("name", { ascending: true }),
    loadArchive(projectId, filters),
  ]);

  const timezone = project?.timezone ?? "Europe/Moscow";

  return (
    <>
      <ArchiveFiltersForm
        projectId={projectId}
        filters={filters}
        categories={categories ?? []}
        executors={executors ?? []}
        today={todayInTimezone(timezone)}
      />
      <ArchiveList projectId={projectId} filters={filters} result={result} timezone={timezone} />
    </>
  );
}
