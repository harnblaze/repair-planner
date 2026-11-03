import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addMonths,
  consumptionReportQuery,
  formatMonthLabel,
  formatQuantity,
} from "@/lib/business/material-report";
import {
  PERIOD_REPORT,
  defaultPeriod,
  periodQuery,
} from "@/lib/business/materials-period";
import { WORKS_REPORT, worksReportQuery } from "@/lib/business/works-report";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { CategoryFilter } from "./category-filter";
import { loadConsumptionReport, resolveCategoryFilter } from "./data";
import { loadMaterialPeriodReport } from "./period/data";
import { PeriodReport } from "./period/period-report";
import { MONTH_SEGMENT_CLASS, TAB_ACTIVE_CLASS, TAB_CLASS } from "./styles";
import { loadWorksReport } from "./works-data";
import { WorksReport } from "./works-report";

export const metadata: Metadata = {
  title: "Отчёты — Планировщик",
};

/** Какая вкладка отчётов открыта. */
type ReportTab = "consumption" | "works" | "period";

/** Вкладки отчётов: при переключении сохраняются месяц и цех текущего отчёта. */
function ReportTabs({
  base,
  active,
  month,
  category,
  from,
  to,
}: {
  base: string;
  active: ReportTab;
  month: string;
  category: string;
  /** Период вкладки «Движение за период» — чтобы она открывалась с теми же датами. */
  from: string;
  to: string;
}) {
  const tabs: { id: ReportTab; label: string; href: string }[] = [
    { id: "consumption", label: "Расход материалов", href: `${base}?${consumptionReportQuery(month, category)}` },
    { id: "works", label: "Выполненные работы", href: `${base}?${worksReportQuery(month, category)}` },
    { id: "period", label: "Движение за период", href: `${base}?${periodQuery(from, to)}` },
  ];

  return (
    // На телефоне три вкладки не влезают: полоса прокручивается вбок, как
    // навигация по разделам, вместо того чтобы распирать страницу.
    <nav
      aria-label="Отчёты"
      className="flex max-w-full self-start overflow-x-auto rounded-[7px] border border-control bg-surface [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={cn(TAB_CLASS, active === tab.id && TAB_ACTIVE_CLASS)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<"/[projectId]/reports">) {
  const { projectId } = await params;
  const {
    month: monthParam,
    category: categoryParam,
    report: reportParam,
    from: fromParam,
    to: toParam,
  } = await searchParams;
  const category = resolveCategoryFilter(categoryParam);
  const isWorks = reportParam === WORKS_REPORT;
  const isPeriod = reportParam === PERIOD_REPORT;
  const base = `/${projectId}/reports`;

  const supabase = await createClient();
  // Архивные цеха остаются в фильтре: по ним могли быть работы и расход в прошлых месяцах.
  const categoriesQuery = supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq("project_id", projectId)
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true });
  const categoryOptions = (rows: { id: string; name: string; is_archived: boolean }[] | null) =>
    (rows ?? []).map((c) => ({ id: c.id, name: c.is_archived ? `${c.name} (архив)` : c.name }));

  if (isWorks) {
    const [works, { data: categories }] = await Promise.all([
      loadWorksReport(projectId, monthParam, category),
      categoriesQuery,
    ]);
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
        <ReportTabs
          base={base}
          active="works"
          month={works.month}
          category={category}
          {...defaultPeriod(works.today)}
        />
        <WorksReport projectId={projectId} category={category} categories={categoryOptions(categories)} report={works} />
      </main>
    );
  }

  if (isPeriod) {
    const period = await loadMaterialPeriodReport(projectId, fromParam, toParam);
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
        <ReportTabs
          base={base}
          active="period"
          // Месяц нужен для переключения на соседние вкладки: берём его из
          // самого периода, чтобы вкладка «Расход» открылась на том же отрезке.
          month={period.from.slice(0, 7)}
          category={category}
          from={period.from}
          to={period.to}
        />
        <PeriodReport projectId={projectId} report={period} />
      </main>
    );
  }

  const [report, { data: categories }] = await Promise.all([
    loadConsumptionReport(projectId, monthParam, category),
    categoriesQuery,
  ]);

  const { month, today } = report;
  const monthLabel = formatMonthLabel(month);
  const isCurrentMonth = month === today.slice(0, 7);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
      <ReportTabs
        base={base}
        active="consumption"
        month={month}
        category={category}
        {...defaultPeriod(today)}
      />
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>Расход материалов по цехам</CardTitle>
          <div className="flex w-full flex-wrap items-center gap-2.5">
            <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
              <Link href={`${base}?${consumptionReportQuery(addMonths(month, -1), category)}`} className={MONTH_SEGMENT_CLASS}>
                ← Пред.
              </Link>
              {!isCurrentMonth ? (
                <Link href={`${base}?${consumptionReportQuery(today.slice(0, 7), category)}`} className={MONTH_SEGMENT_CLASS}>
                  Текущий
                </Link>
              ) : null}
              <Link href={`${base}?${consumptionReportQuery(addMonths(month, 1), category)}`} className={MONTH_SEGMENT_CLASS}>
                След. →
              </Link>
            </div>
            <span className="text-[13px] font-semibold text-ink">{monthLabel}</span>
            <CategoryFilter
              month={month}
              category={category}
              categories={categoryOptions(categories)}
            />
            {report.ok && report.groups.length > 0 ? (
              // Обычная ссылка, а не Link: ответ — файл, а не страница приложения.
              <a
                href={`${base}/export?${consumptionReportQuery(month, category)}`}
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
