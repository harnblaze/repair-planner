import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BalanceBadge } from "@/components/common/balance-badge";
import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/business/dates";
import { movementLabel, withBalanceAfter } from "@/lib/business/material-movements";
import { formatQuantity } from "@/lib/business/material-report";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { CountForm } from "./count-form";
import { ReceiptForm } from "./receipt-form";

export const metadata: Metadata = {
  title: "Материал — Repair Planner",
};

const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX = 500;

function resolveLimit(value: unknown): number {
  const limit = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(limit) || limit < HISTORY_PAGE_SIZE) return HISTORY_PAGE_SIZE;
  return Math.min(limit, HISTORY_MAX);
}

function formatSigned(quantity: number): string {
  return quantity > 0 ? `+${formatQuantity(quantity)}` : formatQuantity(quantity);
}

export default async function MaterialPage({
  params,
  searchParams,
}: PageProps<"/[projectId]/materials/[materialId]">) {
  const { projectId, materialId } = await params;
  const { limit: limitParam } = await searchParams;
  const limit = resolveLimit(limitParam);

  const supabase = await createClient();
  const [{ data: material }, { data: project }, { data: movements, error: movementsError }] =
    await Promise.all([
      supabase
        .from("materials")
        .select("id, name, unit, current_balance, minimum_balance, is_active")
        .eq("id", materialId)
        .eq("project_id", projectId)
        .maybeSingle(),
      supabase.from("projects").select("timezone").eq("id", projectId).maybeSingle(),
      supabase
        .from("material_movements")
        .select(
          "id, kind, quantity, note, occurred_at, task_id, task:tasks!material_movements_task_id_project_id_fkey(id, title)",
        )
        .eq("material_id", materialId)
        .eq("project_id", projectId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit),
    ]);

  // RLS: нет строки — материала нет или нет доступа, намеренно не различается.
  if (!material) {
    notFound();
  }

  if (movementsError) {
    console.error("MaterialPage (movements):", movementsError);
  }

  const timezone = project?.timezone ?? "Europe/Moscow";
  const history = withBalanceAfter(material.current_balance, movements ?? []);
  const base = `/${projectId}/materials/${material.id}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
      <Link href={`/${projectId}/materials`} className="text-[12px] text-meta hover:text-ink">
        ← Материалы
      </Link>

      <Card>
        <CardHeader className="flex flex-col gap-1">
          <CardTitle className={material.is_active ? undefined : "text-meta"}>
            {material.name}
            {material.is_active ? null : <span className="ml-2 text-[12px] font-normal">(неактивен)</span>}
          </CardTitle>
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-meta">
            <span>
              Остаток:{" "}
              <span className="font-mono font-semibold text-ink">
                {formatQuantity(material.current_balance)}
              </span>{" "}
              {material.unit} · мин. {formatQuantity(material.minimum_balance)} {material.unit}
            </span>
            <BalanceBadge balance={material.current_balance} minimumBalance={material.minimum_balance} />
          </p>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Приход</h2>
            <ReceiptForm projectId={projectId} materialId={material.id} unit={material.unit} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Корректировка по пересчёту</h2>
            <CountForm
              projectId={projectId}
              materialId={material.id}
              unit={material.unit}
              currentBalance={material.current_balance}
            />
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>История движений</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {movementsError ? (
            <p className="text-[12.5px] text-status-alert-fg">
              Не удалось загрузить историю. Обновите страницу.
            </p>
          ) : history.length === 0 ? (
            <EmptyState>Движений по материалу пока нет.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line-strong text-left text-[11.5px] whitespace-nowrap text-meta">
                    <th className="py-1.5 pr-3 font-medium">Когда</th>
                    <th className="py-1.5 pr-3 font-medium">Операция</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Кол-во</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Остаток</th>
                    <th className="py-1.5 font-medium">Основание</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {history.map((movement) => (
                    <tr key={movement.id} className="align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-meta">
                        {formatDateTime(movement.occurred_at, timezone)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-ink">
                        {movementLabel(movement.kind, movement.task_id)}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-3 text-right font-mono whitespace-nowrap",
                          movement.quantity > 0 ? "text-ink" : "text-ink-soft",
                        )}
                      >
                        {formatSigned(movement.quantity)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono whitespace-nowrap text-ink">
                        {formatQuantity(movement.balanceAfter)}
                      </td>
                      <td className="py-2 text-ink-soft">
                        {movement.task ? (
                          <Link
                            href={`/${projectId}/tasks/${movement.task.id}`}
                            className="text-ink underline-offset-2 hover:underline"
                          >
                            {movement.task.title}
                          </Link>
                        ) : (
                          movement.note
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {history.length === limit && limit < HISTORY_MAX ? (
            <Link
              href={`${base}?limit=${limit + HISTORY_PAGE_SIZE}`}
              scroll={false}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
            >
              Показать ещё
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
