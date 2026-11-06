"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { urlBase64ToUint8Array } from "@/lib/business/push";

// Включение уведомлений на телефоне. Подписка — это устройство, а не аккаунт:
// одна и та же учётная запись с телефона и с компьютера даёт две строки в базе.
//
// Почему сервис-воркер регистрируется здесь, а не в общем компоненте: там он
// только для production (в next dev мешает перезагрузке), а подписка без
// активного воркера невозможна. Кто включил уведомления — у того воркер есть.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type Phase = "checking" | "unsupported" | "off" | "blocked" | "on" | "busy";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Установленное приложение (на iPhone только там работают пуши). */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function PushSettings({ serverReady }: { serverReady: boolean }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState<string | null>(null);

  // Существующая подписка — источник правды о состоянии переключателя:
  // разрешение может быть выдано, а подписки уже не быть (сброс браузера).
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!supportsPush()) {
        if (!cancelled) setPhase("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPhase("blocked");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setPhase(subscription ? "on" : "off");
      } catch {
        if (!cancelled) setPhase("off");
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setPhase("busy");
    setMessage(null);
    try {
      // Спрашиваем разрешение первым: браузер требует жест пользователя,
      // а любая регистрация воркера до вопроса этот жест уже «съедает».
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPhase("blocked");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
      });

      const json = subscription.toJSON();
      const result = await savePushSubscriptionAction({
        endpoint: json.endpoint ?? subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent.slice(0, 400),
      });

      if (!result.ok) {
        await subscription.unsubscribe();
        setPhase("off");
        setMessage(result.error);
        return;
      }

      setPhase("on");
      setMessage(null);
    } catch (error) {
      // Три частые причины, и все три — не поломка приложения:
      //  • приватное окно: Chrome не отдаёт Push API и не даёт это определить;
      //  • iPhone в обычной вкладке Safari: пуши только у приложения с экрана «Домой»;
      //  • всё остальное: разрешение отозвали в настройках браузера.
      const reason = error instanceof Error ? error.message : "";
      setPhase("off");
      if (/incognito|private/i.test(reason)) {
        setMessage("В приватном окне браузер не поддерживает уведомления. Откройте сайт в обычном окне.");
      } else if (isIos() && !isStandalone()) {
        setMessage(
          "На iPhone уведомления работают только у приложения с экрана «Домой»: откройте сайт в Safari → «Поделиться» → «На экран Домой», затем включите здесь.",
        );
      } else {
        setMessage(
          "Не удалось включить уведомления. Проверьте разрешения браузера — в приватном окне уведомления не работают.",
        );
      }
    }
  }, []);

  const disable = useCallback(async () => {
    setPhase("busy");
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await removePushSubscriptionAction(endpoint);
      }
      setPhase("off");
    } catch {
      setPhase("on");
      setMessage("Не удалось выключить уведомления. Попробуйте ещё раз.");
    }
  }, []);

  const sendTest = useCallback(async () => {
    const result = await sendTestPushAction();
    if (result.ok) {
      toast.success(result.message ?? "Уведомление отправлено.");
    } else {
      toast.error(result.error);
    }
  }, []);

  if (!serverReady) {
    return (
      <p className="text-[12px] text-meta">
        На сервере не заданы ключи уведомлений — функция выключена. Сообщите администратору.
      </p>
    );
  }

  if (phase === "checking") {
    return <p className="text-[12px] text-meta">Проверяем настройки устройства…</p>;
  }

  if (phase === "unsupported") {
    return (
      <p className="text-[12px] text-meta">
        Этот браузер не поддерживает уведомления. На компьютере подойдут Chrome, Edge или Safari,
        на телефоне — Chrome (Android) или Safari с добавлением на экран «Домой» (iPhone).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">
          {phase === "on" ? "Включены на этом устройстве" : "Выключены"}
        </span>
        <div className="flex items-center gap-1.5">
          {phase === "on" ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void sendTest()}>
                Проверить
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void disable()}>
                Выключить
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={phase === "busy"}
              onClick={() => void enable()}
            >
              Включить
            </Button>
          )}
        </div>
      </div>

      <p className="text-[12px] text-meta">
        {phase === "on"
          ? "Уведомление придёт о каждом новом сообщении в чате проектов, где вы участвуете. Автору сообщения не приходит."
          : "Уведомления о новых сообщениях в чате приходят на этот телефон или компьютер, даже если сайт закрыт."}
      </p>

      {phase === "blocked" ? (
        <p className="text-[12px] text-status-alert-fg">
          Уведомления запрещены в настройках браузера для этого сайта. Разрешите их в адресной
          строке или в настройках сайта и вернитесь сюда.
        </p>
      ) : null}

      {isIos() && !isStandalone() ? (
        <p className="text-[12px] text-meta">
          На iPhone: откройте сайт в Safari → «Поделиться» → «На экран Домой», затем включите
          уведомления в появившемся приложении — в обычной вкладке Safari они не работают.
        </p>
      ) : null}

      {message ? <p className="text-[12px] text-status-alert-fg">{message}</p> : null}
    </div>
  );
}
