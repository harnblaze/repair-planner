import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { RUSSIAN_TIMEZONES } from "@/lib/validation/project";

import { MembersSection } from "./members-section";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Настройки проекта — Repair Planner",
};

export default async function ProjectSettingsPage({ params }: PageProps<"/[projectId]/settings">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, role] = await Promise.all([
    supabase.from("projects").select("name, timezone").eq("id", projectId).single(),
    getProjectRole(projectId),
  ]);

  if (!project) {
    notFound();
  }

  const timezoneLabel =
    RUSSIAN_TIMEZONES.find((tz) => tz.value === project.timezone)?.label ?? project.timezone;

  return (
    <main className="mx-auto flex max-w-md w-full flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader>
          <CardTitle>Настройки проекта</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageProject(role) ? (
            <SettingsForm projectId={projectId} project={project} />
          ) : (
            <dl className="flex flex-col gap-3 text-[12.5px]">
              <div className="flex flex-col gap-0.5">
                <dt className="text-meta">Название проекта</dt>
                <dd className="text-ink">{project.name}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-meta">Часовой пояс</dt>
                <dd className="text-ink">{timezoneLabel}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Производственный календарь</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-muted">
            Праздники, перенесённые выходные и рабочие субботы. Учитываются на доске и при переносе
            заявок.
          </p>
          <Link
            href={`/${projectId}/settings/calendar`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
          >
            Открыть календарь
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Дополнительные списки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-muted">
            Списки на доске рядом с «Текущими заявками»: добавление своих, переименование и порядок.
          </p>
          <Link
            href={`/${projectId}/settings/lists`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
          >
            Открыть списки
          </Link>
        </CardContent>
      </Card>

      <MembersSection projectId={projectId} role={role} timezone={project.timezone} />
    </main>
  );
}
