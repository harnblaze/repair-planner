"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

// Сколько ждём сессию, если токены пришли во фрагменте URL. Браузерный клиент
// Supabase разбирает фрагмент при создании, но это происходит после гидратации,
// поэтому ждём с запасом и опрашиваем getSession.
const POLL_MS = 150;
const TIMEOUT_MS = 6000;

/**
 * Переходник для implicit-флоу: ссылка из письма привела на страницу с
 * токенами во фрагменте (#access_token=…). До сервера фрагмент не доходит,
 * поэтому сессию поднимает supabase-js в браузере, а задача компонента —
 * дождаться её и уйти на нужный экран.
 */
export function ConfirmFromHash({ next }: { next: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const supabase = createClient();

    // Клиент Supabase в SSR-режиме всегда работает в PKCE и implicit-ссылку
    // (#access_token=…) сам не разбирает — он её отвергает как чужой флоу.
    // Поэтому сессию из фрагмента поднимаем руками: setSession принимает
    // готовые токены и в PKCE-клиенте работает.
    const fromHash = () => {
      const params = new URLSearchParams(location.hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      return accessToken && refreshToken ? { accessToken, refreshToken } : null;
    };

    const tick = async () => {
      const tokens = fromHash();
      if (tokens) {
        const { error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (cancelled) return;
        if (error) {
          setFailed(true);
          return;
        }
        // Токены из адресной строки убираем: ссылка одноразовая.
        window.history.replaceState(null, "", location.pathname + location.search);
        router.replace(next);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data.session) {
        // replace, а не push: одноразовая ссылка не должна оставаться в истории.
        router.replace(next);
        return;
      }

      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setFailed(true);
        return;
      }

      timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [next, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{failed ? "Ссылка недействительна" : "Проверяем ссылку"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {failed ? (
          <>
            <p className="text-sm text-meta">
              Ссылка недействительна или устарела. Запросите новую — придёт на ту же почту.
            </p>
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/forgot-password" />}
            >
              Запросить новую
            </Button>
          </>
        ) : (
          <p className="text-sm text-meta">Это займёт пару секунд. Не закрывайте страницу.</p>
        )}
      </CardContent>
    </Card>
  );
}
