import type { Metadata } from "next";

import { todayInTimezone } from "@/lib/business/dates";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import { SupplyBoard } from "./supply-board";
import { loadSupplyMaterials, loadSupplyRequests } from "./supply-data";

export const metadata: Metadata = {
  title: "Снабжение — Планировщик",
};

export default async function SupplyPage({ params }: PageProps<"/[projectId]/supply">) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [role, { data: project }, requests, materials] = await Promise.all([
    getProjectRole(projectId),
    supabase.from("projects").select("timezone").eq("id", projectId).single(),
    loadSupplyRequests(projectId),
    loadSupplyMaterials(projectId),
  ]);

  const today = todayInTimezone(project?.timezone ?? "Europe/Moscow");

  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-5 pt-6 pb-7">
      <h1 className="text-[17px] font-semibold text-ink">Снабжение</h1>
      {requests === null ? (
        <p className="text-[12.5px] text-status-alert-fg">Не удалось загрузить заявки на ТМЦ. Обновите страницу.</p>
      ) : (
        <SupplyBoard
          projectId={projectId}
          requests={requests}
          materials={materials}
          canEdit={canEditProject(role)}
          today={today}
        />
      )}
    </main>
  );
}
