"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-[12px] text-meta">
        Не удалось загрузить страницу. Попробуйте ещё раз.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={reset}>
          Попробовать снова
        </Button>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/projects" />}>
          К проектам
        </Button>
      </div>
    </main>
  );
}
