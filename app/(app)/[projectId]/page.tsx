import { redirect } from "next/navigation";

export default async function ProjectHomePage({ params }: PageProps<"/[projectId]">) {
  const { projectId } = await params;
  redirect(`/${projectId}/board`);
}
