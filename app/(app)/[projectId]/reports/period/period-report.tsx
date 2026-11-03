import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/business/material-report";
import {
  PERIOD_REPORT,
  formatLastMoved,
  formatPeriodLabel,
  isMoved,
  matchPreset,
  periodQuery,
  presetPeriod,
  sortPeriodRows,
  summarizePeriod,
  type PeriodPreset,
  type PeriodRow,
} from "@/lib/business/materials-period";
import { cn } from "@/lib/utils";

import { MONTH_SEGMENT_CLASS } from "../styles";
import type { MaterialPeriodReport } from "./data";

const PRESET_LABEL: Record<PeriodPreset, string> = {
  "this-month": "Этот месяц",
  "last-month": "Прошлый месяц",
  "three-months": "3 месяца",
};

const PRESET_ACTIVE_CLASS = "bg-brand-surface text-brand hover:bg-brand-surface hover:text-brand";

/** Вкладка «Движение за период»: приход и расход за любой отрезок времени. */
export function PeriodReport({ projectId, report }: { projectId: string; report: MaterialPeriodReport }) {
  const base = `/${projectId}/reports`;
  const period = { from: report.from, to: report.to };
  const label = formatPeriodLabel(report.from, report.to);
  const activePreset = matchPreset(period, report.today);

  // RPC уже упорядочил строки, но порядок не должен зависеть от базы.
  const sorted = sortPeriodRows(report.rows);
  const moved = sorted.filter(isMoved);
  const still = sorted.filter((row) => !isMoved(row));
  const summary = summarizePeriod(sorted);
  // Материалы без движения показываем только с ненулевым остатком: нулевой
  // остаток без движений — это «закончился», отдельной строкой он не нужен.
  const stillWithBalance = still.filter((row) => row.balanceAtEnd !== 0);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <CardTitle>Движение материалов за период</CardTitle>

        <div className="flex w-full flex-wrap items-center gap-2.5">
          <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
            {(Object.keys(PRESET_LABEL) as PeriodPreset[]).map((preset) => {
              const range = presetPeriod(preset, report.today);
              return (
                <Link
                  key={preset}
                  href={`${base}?${periodQuery(range.from, range.to)}`}
                  aria-current={activePreset === preset ? "page" : undefined}
                  className={cn(MONTH_SEGMENT_CLASS, activePreset === preset && PRESET_ACTIVE_CLASS)}
                >
                  {PRESET_LABEL[preset]}
                </Link>
              );
            })}
          </div>

          {/* Обычная GET-форма: даты уходят в адресную строку, отдельный обработчик не нужен. */}
          <form method="get" action={base} className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="report" value={PERIOD_REPORT} />
            <label className="sr-only" htmlFor="period-from">
              Начало периода
            </label>
            <Input
              // key: при смене периода компонент пересоздаётся, иначе Base UI
              // ругается на смену defaultValue у уже инициализированного поля.
              key={`from-${report.from}`}
              id="period-from"
              type="date"
              name="from"
              defaultValue={report.from}
              max={report.to}
              className="h-[30px] w-[142px] text-[12.5px]"
            />
            <span className="text-[12px] text-meta">—</span>
            <label className="sr-only" htmlFor="period-to">
              Конец периода
            </label>
            <Input
              key={`to-${report.to}`}
              id="period-to"
              type="date"
              name="to"
              defaultValue={report.to}
              min={report.from}
              className="h-[30px] w-[142px] text-[12.5px]"
            />
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "h-[30px] px-2.5")}>
              Показать
            </button>
          </form>

          {report.ok && sorted.length > 0 ? (
            // Обычная ссылка: ответ — файл, а не страница приложения.
            <a
              href={`${base}/period/export?${periodQuery(report.from, report.to)}`}
              className={cn(buttonVariants({ variant: "outline" }), "h-[30px] px-2.5 sm:ml-auto")}
            >
              Скачать CSV
            </a>
          ) : null}
        </div>

        <p className="text-[11.5px] text-meta-alt">
          {label} · движение считается по дате записи в журнале; остаток на конец — сколько было на
          последний день периода.
        </p>

        {report.invalid ? (
          <p className="text-[11.5px] text-status-alert-fg">
            Даты в ссылке не разобрались — показан текущий месяц.
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!report.ok ? (
          <p className="text-[12.5px] text-status-alert-fg">
            Не удалось построить отчёт. Обновите страницу.
          </p>
        ) : sorted.length === 0 ? (
          <EmptyState>В проекте пока нет материалов.</EmptyState>
        ) : (
          <>
            {/* Сводка: что двигалось, что нет и сколько всего ушло. */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
              <span className="text-meta">
                Двигалось: <span className="font-semibold text-ink">{summary.moved}</span>
              </span>
              <span className="text-meta">
                Без движения: <span className="font-semibold text-ink">{summary.still}</span>
              </span>
              <span className="text-meta">
                Расход:{" "}
                <span className="font-mono font-semibold text-ink">{formatQuantity(summary.consumption)}</span>
              </span>
              <span className="text-meta">
                Приход:{" "}
                <span className="font-mono font-semibold text-ink">{formatQuantity(summary.receipt)}</span>
              </span>
            </div>

            {moved.length === 0 ? (
              <EmptyState>За {label.toLowerCase()} материалы не двигались.</EmptyState>
            ) : (
              // Таблица шире телефона: прокрутка внутри карточки, страница не едет.
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[500px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line-strong text-left text-[11.5px] text-meta">
                      <th className="py-1.5 pr-3 font-medium">Материал</th>
                      <th className="py-1.5 pr-3 font-medium">Ед.</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Приход</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Расход</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Остаток</th>
                      <th className="py-1.5 text-right font-medium">Движение</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {moved.map((row) => (
                      <tr key={row.materialId}>
                        <td className="py-2 pr-3 text-ink">{row.name}</td>
                        <td className="py-2 pr-3 text-meta">{row.unit}</td>
                        <td className="py-2 pr-3 text-right font-mono whitespace-nowrap text-ink">
                          {row.receipt === 0 ? <span className="text-faint">—</span> : formatQuantity(row.receipt)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono whitespace-nowrap text-ink">
                          {row.consumption === 0 ? <span className="text-faint">—</span> : formatQuantity(row.consumption)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono whitespace-nowrap text-ink">
                          {formatQuantity(row.balanceAtEnd)}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap text-meta">
                          {formatLastMoved(row, report.timezone)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line-strong text-[11.5px]">
                      <th className="py-1.5 pr-3 text-left font-medium text-meta" colSpan={2}>
                        Итого
                      </th>
                      <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap text-ink">
                        {formatQuantity(summary.receipt)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap text-ink">
                        {formatQuantity(summary.consumption)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {stillWithBalance.length > 0 ? (
              // Отдельным блоком, а не в таблице: у этих материалов в периоде
              // ничего не происходило, и сравнивать их с двигавшимися незачем.
              <section className="flex flex-col gap-1.5">
                <h2 className="border-b border-line-subtle pb-1 text-[12px] font-semibold text-ink-soft">
                  Без движения за период
                </h2>
                <ul className="flex flex-col divide-y divide-line-subtle">
                  {stillWithBalance.map((row: PeriodRow) => (
                    <li key={row.materialId} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
                      <span className="text-ink">{row.name}</span>
                      <span className="font-mono whitespace-nowrap text-meta">
                        остаток {formatQuantity(row.balanceAtEnd)} <span className="text-faint">{row.unit}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
