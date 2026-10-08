import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateNumeric } from "@/lib/business/dates";
import { addMonths, formatMonthLabel } from "@/lib/business/material-report";
import { WORKS_REPORT, formatMaterials, worksReportQuery } from "@/lib/business/works-report";
import { cn } from "@/lib/utils";

import { CategoryFilter } from "./category-filter";
import { MONTH_SEGMENT_CLASS } from "./styles";
import type { WorksReport as WorksReportData } from "./works-data";

/** Вкладка «Выполненные работы» (docs/superpowers/specs/2026-10-08-completed-works-report-design.md §3). */
export function WorksReport({
  projectId,
  category,
  categories,
  report,
}: {
  projectId: string;
  category: string;
  categories: { id: string; name: string }[];
  report: WorksReportData;
}) {
  const { month, today, timezone } = report;
  const monthLabel = formatMonthLabel(month);
  const isCurrentMonth = month === today.slice(0, 7);
  const base = `/${projectId}/reports`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <CardTitle>Выполненные работы по цехам</CardTitle>
        <div className="flex w-full flex-wrap items-center gap-2.5">
          <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
            <Link href={`${base}?${worksReportQuery(addMonths(month, -1), category)}`} className={MONTH_SEGMENT_CLASS}>
              ← Пред.
            </Link>
            {!isCurrentMonth ? (
              <Link href={`${base}?${worksReportQuery(today.slice(0, 7), category)}`} className={MONTH_SEGMENT_CLASS}>
                Текущий
              </Link>
            ) : null}
            <Link href={`${base}?${worksReportQuery(addMonths(month, 1), category)}`} className={MONTH_SEGMENT_CLASS}>
              След. →
            </Link>
          </div>
          <span className="text-[13px] font-semibold text-ink">{monthLabel}</span>
          <CategoryFilter report={WORKS_REPORT} month={month} category={category} categories={categories} />
          {report.ok && report.groups.length > 0 ? (
            // Обычная ссылка, а не Link: ответ — файл, а не страница приложения.
            <a
              href={`${base}/works/export?${worksReportQuery(month, category)}`}
              className={cn(buttonVariants({ variant: "outline" }), "sm:ml-auto")}
            >
              Скачать CSV
            </a>
          ) : null}
        </div>
        <p className="text-[11.5px] text-meta-alt">
          Заявки, выполненные в этом месяце. Цех — текущая категория заявки. Материалы — итог расхода по заявке;
          если расход правили в другом месяце, он может не совпасть с отчётом по расходу.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!report.ok ? (
          <p role="alert" className="text-[12.5px] text-status-alert-fg">
            Не удалось построить отчёт. Обновите страницу.
          </p>
        ) : report.groups.length === 0 ? (
          <EmptyState>За {monthLabel.toLowerCase()} выполненных работ нет.</EmptyState>
        ) : (
          report.groups.map((group) => (
            <section key={group.categoryId ?? "none"} className="flex flex-col">
              <h2 className="border-b border-line-strong pb-1.5 text-[13px] font-semibold text-ink">
                {group.categoryName} · {group.works.length}
              </h2>
              <ul className="divide-y divide-line-subtle text-[12.5px]">
                {group.works.map((work) => (
                  <li key={work.taskId} className="flex gap-3 py-2">
                    <span className="w-11 shrink-0 font-mono text-[12px] text-meta">
                      {formatDateNumeric(work.completedAt, timezone).slice(0, 5)}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Link href={`/${projectId}/tasks/${work.taskId}`} className="break-words text-ink hover:underline">
                        {work.title}
                      </Link>
                      {work.executorNames.length > 0 ? (
                        <span className="text-[12px] break-words text-meta">{work.executorNames.join(", ")}</span>
                      ) : null}
                      {work.materials.length > 0 ? (
                        <span className="text-[12px] break-words text-meta-alt">{formatMaterials(work.materials)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
