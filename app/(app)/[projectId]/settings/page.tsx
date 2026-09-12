import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Настройки проекта — Repair Planner",
};

export default async function ProjectSettingsPage({ params }: PageProps<"/[projectId]/settings">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name, timezone")
    .eq("id", projectId)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Настройки проекта</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm projectId={projectId} project={project} />
        </CardContent>
      </Card>
    </main>
  );
}
