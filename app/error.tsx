"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
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
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-[12px] text-meta">
        Что-то пошло не так. Попробуйте ещё раз.
      </p>
      <Button size="sm" onClick={reset}>
        Попробовать снова
      </Button>
    </main>
  );
}
