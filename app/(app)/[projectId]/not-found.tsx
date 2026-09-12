import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-[12px] text-meta">
        Страница не найдена — проект не существует, был удалён, либо у вас нет к нему доступа.
      </p>
      <Button size="sm" nativeButton={false} render={<Link href="/projects" />}>
        К проектам
      </Button>
    </main>
  );
}
