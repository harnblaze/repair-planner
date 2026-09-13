import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ALL_CATEGORIES,
  addMonths,
  formatMonthLabel,
  formatQuantity,
} from "@/lib/business/material-report";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { CategoryFilter } from "./category-filter";
import { loadConsumptionReport, resolveCategoryFilter } from "./data";

export const metadata: Metadata = {
  title: "Отчёт по расходу — Repair Planner",
};

// Сегментированная группа кнопок месяца — как навигация по неделям на доске.
const MONTH_SEGMENT_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink active:bg-[#EBEFF5]";

function reportQuery(month: string, category: string): string {
  const params = new URLSearchParams({ month });
  if (category !== ALL_CATEGORIES) params.set("category", category);
  return params.toString();
}

export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<"/[projectId]/reports">) {
  const { projectId } = await params;
  const { month: monthParam, category: categoryParam } = await searchParams;
  const category = resolveCategoryFilter(categoryParam);

  const supabase = await createClient();
  const [report, { data: categories }] = await Promise.all([
    loadConsumptionReport(projectId, monthParam, category),
    // Архивные цеха остаются в фильтре: по ним мог быть расход в прошлых месяцах.
    supabase
      .from("categories")
      .select("id, name, is_archived")
      .eq("project_id", projectId)
      .order("is_archived", { ascending: true })
      .order("sort_order", { ascending: true }),
  ]);

  const { month, today } = report;
  const monthLabel = formatMonthLabel(month);
  const isCurrentMonth = month === today.slice(0, 7);
  const base = `/${projectId}/reports`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>Расход материалов по цехам</CardTitle>
          <div className="flex w-full flex-wrap items-center gap-2.5">
            <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
              <Link href={`${base}?${reportQuery(addMonths(month, -1), category)}`} className={MONTH_SEGMENT_CLASS}>
                ← Пред.
              </Link>
              {!isCurrentMonth ? (
                <Link href={`${base}?${reportQuery(today.slice(0, 7), category)}`} className={MONTH_SEGMENT_CLASS}>
                  Текущий
                </Link>
              ) : null}
              <Link href={`${base}?${reportQuery(addMonths(month, 1), category)}`} className={MONTH_SEGMENT_CLASS}>
                След. →
              </Link>
            </div>
            <span className="text-[13px] font-semibold text-ink">{monthLabel}</span>
            <CategoryFilter
              month={month}
              category={category}
              categories={(categories ?? []).map((c) => ({
                id: c.id,
                name: c.is_archived ? `${c.name} (архив)` : c.name,
              }))}
            />
            {report.ok && report.groups.length > 0 ? (
              // Обычная ссылка, а не Link: ответ — файл, а не страница приложения.
              <a
                href={`${base}/export?${reportQuery(month, category)}`}
                className={cn(buttonVariants({ variant: "outline" }), "sm:ml-auto")}
              >
                Скачать CSV
              </a>
            ) : null}
          </div>
          <p className="text-[11.5px] text-meta-alt">
            Расход относится к месяцу, в котором он записан в заявке; правка количества — к месяцу
            правки. Цех — текущая категория заявки.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {!report.ok ? (
            <p className="text-[12.5px] text-status-alert-fg">
              Не удалось построить отчёт. Обновите страницу.
            </p>
          ) : report.groups.length === 0 ? (
            <EmptyState>За {monthLabel.toLowerCase()} расход материалов не записан.</EmptyState>
          ) : (
            report.groups.map((group) => (
              <section key={group.categoryId ?? "none"} className="flex flex-col">
                <h2 className="border-b border-line-strong pb-1.5 text-[13px] font-semibold text-ink">
                  {group.categoryName}
                </h2>
                <table className="w-full text-[12.5px]">
                  <thead className="sr-only">
                    <tr>
                      <th>Материал</th>
                      <th>Расход</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {group.items.map((item) => (
                      <tr key={item.materialId}>
                        <td className="py-2 pr-3 text-ink">{item.materialName}</td>
                        <td className="py-2 text-right font-mono whitespace-nowrap text-ink">
                          {formatQuantity(item.quantity)}{" "}
                          <span className="text-meta">{item.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
