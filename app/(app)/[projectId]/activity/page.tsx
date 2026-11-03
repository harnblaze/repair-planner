import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  activityHref,
  activityTime,
  describeRowFor,
  groupByDay,
  isOwnMention,
  type ActivityRow,
} from "@/lib/business/activity";
import { authorFullName, toAuthorMap } from "@/lib/business/author";
import { todayInTimezone } from "@/lib/business/dates";
import { addDays } from "@/lib/business/working-days";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { MarkActivitySeen } from "./mark-activity-seen";

export const metadata: Metadata = {
  title: "Лента проекта — Планировщик",
};

// Лента растёт на одну страницу за нажатие «Показать ещё»: limit — сколько
// строк показать всего, а не номер страницы (как в истории материала).
const PAGE_SIZE = 30;
const MAX_LIMIT = 300;

function resolveLimit(value: unknown): number {
  const limit = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(limit) || limit < PAGE_SIZE) return PAGE_SIZE;
  return Math.min(limit, MAX_LIMIT);
}

/** Автор строки: имя участника на момент запроса, «Импорт» — запись из SQL. */
function actorLabel(names: Map<string, string | null>, actorId: string | null): string {
  if (!actorId) return "Импорт";
  return authorFullName(names, actorId) ?? "Участник покинул проект";
}

export default async function ProjectActivityPage({ params, searchParams }: PageProps<"/[projectId]/activity">) {
  const { projectId } = await params;
  const { limit: limitParam } = await searchParams;
  const limit = resolveLimit(limitParam);

  const supabase = await createClient();
  // Смотрящий нужен, чтобы своё упоминание читалось «вас упомянули» и было видно.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: project }, { data: rows, error: rowsError }, { data: members }] = await Promise.all([
    supabase.from("projects").select("name, timezone").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_activity")
      .select("id, actor_id, kind, entity_type, entity_id, payload, created_at")
      .eq("project_id", projectId)
      // Строку сверх лимита берём, чтобы знать, есть ли продолжение.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    // Имена участников — одним запросом: profiles закрыт RLS на свою строку,
    // чужие имена отдаёт только security definer функция (0012).
    supabase.rpc("project_member_list", { p_project_id: projectId }),
  ]);

  // RLS: нет строки — проекта нет или нет доступа, намеренно не различается.
  if (!project) {
    notFound();
  }

  if (rowsError) {
    console.error("ProjectActivityPage:", rowsError);
  }

  const timezone = project.timezone;
  const all: ActivityRow[] = rows ?? [];
  const hasMore = all.length > limit;
  const visible = hasMore ? all.slice(0, limit) : all;

  const names = toAuthorMap(members);
  const today = todayInTimezone(timezone);
  const groups = groupByDay(visible, timezone, today, addDays(today, -1));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
      {/* Открыли ленту — она прочитана до самой свежей записи. */}
      <MarkActivitySeen projectId={projectId} latestAt={visible[0]?.created_at ?? null} />
      <Card>
        <CardHeader>
          <CardTitle>Лента проекта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {groups.length === 0 ? (
            <EmptyState>Пока пусто: здесь появятся созданные заявки, смены статусов и другие изменения.</EmptyState>
          ) : (
            groups.map((group) => (
              <section key={group.day} className="flex flex-col gap-1.5">
                <h2 className="text-[11px] font-medium text-meta">{group.label}</h2>
                <div className="flex flex-col gap-1">
                  {group.rows.map((row) => {
                    const href = activityHref(projectId, row);
                    const phrase = describeRowFor(row, user?.id ?? null);
                    const actor = actorLabel(names, row.actor_id);
                    const mine = isOwnMention(row, user?.id ?? null);

                    return (
                      <div
                        key={row.id}
                        // Своё упоминание подсвечиваем: это то, ради чего в ленту
                        // заходят — «меня звали».
                        className={cn(
                          "flex min-w-0 items-baseline gap-2 rounded-[6px] px-1.5 py-0.5 text-[12.5px]",
                          mine && "-mx-1.5 bg-brand-surface",
                        )}
                      >
                        <span className="shrink-0 tabular-nums text-[11.5px] text-meta-dim">
                          {activityTime(row.created_at, timezone)}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-ink">
                          <span className="font-medium">{actor}</span>
                          {": "}
                          {href ? (
                            <Link
                              href={href}
                              className="underline-offset-2 transition-colors duration-120 hover:underline"
                            >
                              {phrase}
                            </Link>
                          ) : (
                            phrase
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {hasMore && visible.length < MAX_LIMIT ? (
            <Link
              href={`/${projectId}/activity?limit=${limit + PAGE_SIZE}`}
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
