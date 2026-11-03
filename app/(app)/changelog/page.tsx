import type { Metadata } from "next";

import { BackLink } from "@/components/common/back-link";
import { BADGE_BASE } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHANGELOG,
  CHANGELOG_KIND_LABEL,
  formatChangelogDate,
  type ChangelogKind,
} from "@/lib/business/changelog";
import { cn } from "@/lib/utils";

import { MarkChangelogSeen } from "./mark-changelog-seen";

export const metadata: Metadata = {
  title: "Что нового — Планировщик",
};

// Бейджи переиспользуют цвета статусов: «Новое» — как «в работе», «Исправлено» —
// как «готово», «Улучшено» — как «запланировано». Новых цветов не вводим.
const KIND_CLASSES: Record<ChangelogKind, string> = {
  new: "bg-status-progress-bg text-status-progress-fg",
  fix: "bg-status-done-bg text-status-done-fg",
  improve: "bg-status-planned-bg text-status-planned-fg",
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
      <MarkChangelogSeen />
      <BackLink fallbackHref="/projects" />

      <div className="flex flex-col gap-1">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Что нового</h1>
        <p className="text-[12.5px] text-meta">Здесь видно, что появилось в планировщике.</p>
      </div>

      <ol className="flex flex-col gap-3">
        {CHANGELOG.map((entry) => (
          <li key={entry.id}>
            <Card size="sm">
              <CardHeader className="gap-1.5">
                <span className="text-[11px] text-meta">{formatChangelogDate(entry.date)}</span>
                <CardTitle className="text-[15px]">{entry.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {entry.items.map((item) => (
                    <li key={item.text} className="flex items-start gap-2">
                      {/* Бейдж не сжимается: текст переносится, подпись — нет. */}
                      <span className={cn(BADGE_BASE, "mt-px flex-none", KIND_CLASSES[item.kind])}>
                        {CHANGELOG_KIND_LABEL[item.kind]}
                      </span>
                      <span className="min-w-0 text-[12.5px] leading-snug text-ink-soft">
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <p className="text-[11.5px] text-meta">
        Список пополняется по мере выкатки: сюда попадает всё, что заметно в работе.
      </p>
    </main>
  );
}
