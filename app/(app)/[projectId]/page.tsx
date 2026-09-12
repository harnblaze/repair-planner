import { createClient } from "@/lib/supabase/server";

export default async function ProjectHomePage({ params }: PageProps<"/[projectId]">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name, timezone")
    .eq("id", projectId)
    .single();

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-2 p-4 pt-16 text-center">
      <h1 className="text-xl font-semibold">{project?.name}</h1>
      <p className="text-sm text-muted-foreground">Часовой пояс: {project?.timezone}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Доска с рабочими днями появится на следующем этапе.
      </p>
    </main>
  );
}
