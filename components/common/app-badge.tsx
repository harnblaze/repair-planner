"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { chatUnreadTotalAction } from "@/app/(app)/badge-actions";
import { faviconLabel, titleWithBadge } from "@/lib/business/badge";

// Значок «сколько непрочитанного» на иконке приложения и на иконке вкладки.
//
// Три механизма, потому что по-другому не покрыть все случаи:
//  • Badging API (navigator.setAppBadge) — число на иконке установленного
//    приложения: Android ставит его, iOS показывает точку/число у приложения
//    с экрана «Домой»;
//  • иконка вкладки — рисуем на canvas иконку с красным кружком: отдельного
//    API для этого нет;
//  • заголовок вкладки — «(3) Доска», видно и в списке вкладок, и в истории.
//
// Число обновляем по таймеру и на возвращение к вкладке: держать Realtime-
// подписку ради значка дороже, чем один запрос в минуту.

const POLL_MS = 60_000;
const ICON_URL = "/icons/icon-192.png";
const BADGE_COLOR = "#e5484d";

let iconPromise: Promise<HTMLImageElement | null> | null = null;

function loadIcon(): Promise<HTMLImageElement | null> {
  if (iconPromise) return iconPromise;
  iconPromise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = ICON_URL;
  });
  return iconPromise;
}

async function drawIcon(count: number): Promise<string | null> {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = await loadIcon();
  if (image) {
    ctx.drawImage(image, 0, 0, 64, 64);
  } else {
    // Иконка не загрузилась — рисуем хотя бы узнаваемый квадрат, чем ничего.
    ctx.fillStyle = "#2f6fed";
    ctx.fillRect(0, 0, 64, 64);
  }

  const label = faviconLabel(count);
  if (!label) return null;

  ctx.beginPath();
  ctx.arc(46, 46, 17, 0, Math.PI * 2);
  ctx.fillStyle = BADGE_COLOR;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 1 ? 18 : 22}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 46, 47);

  return canvas.toDataURL("image/png");
}

function setAppBadgeSafe(count: number) {
  if (typeof navigator === "undefined") return;
  const badge = (navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge;
  const clear = (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge;
  try {
    if (count > 0) void badge?.call(navigator, count);
    else void clear?.call(navigator);
  } catch {
    // Badging API нет (Safari на компьютере, старый Android) — значок на
    // вкладке всё равно работает.
  }
}

export function AppBadge({ initial }: { initial: number }) {
  const countRef = useRef(initial);
  const linkRef = useRef<HTMLLinkElement | null>(null);
  const pathname = usePathname();

  const applyBadge = useCallback(async (count: number) => {
    countRef.current = count;

    setAppBadgeSafe(count);

    // Заголовок: снимаем прежний счётчик и ставим новый. Название страницы
    // берём из текущего заголовка — Next выставляет своё при каждой навигации.
    document.title = titleWithBadge(document.title, count);

    // Иконка вкладки: свой link последним — браузер берёт его вместо исходного.
    if (count <= 0) {
      linkRef.current?.remove();
      linkRef.current = null;
      return;
    }

    const href = await drawIcon(count);
    if (!href) return;

    if (!linkRef.current) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/png";
      link.dataset.appBadge = "true";
      document.head.appendChild(link);
      linkRef.current = link;
    }
    linkRef.current.href = href;
  }, []);

  const refresh = useCallback(async () => {
    const count = await chatUnreadTotalAction();
    if (count === null) return;
    await applyBadge(count);
  }, [applyBadge]);

  useEffect(() => {
    void applyBadge(countRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- начальное значение только при монтировании
  }, []);

  // Новая страница — свой заголовок: возвращаем счётчик после навигации.
  useEffect(() => {
    void applyBadge(countRef.current);
    void refresh();
  }, [pathname, applyBadge, refresh]);

  // Next переписывает <title> уже после нашего эффекта, и счётчик терялся.
  // Следим за самим заголовком: как только его сменили, возвращаем счётчик.
  // titleWithBadge снимает прежний счётчик, поэтому повтор не зацикливается.
  useEffect(() => {
    const titleElement = document.querySelector("title");
    if (!titleElement) return;

    const observer = new MutationObserver(() => {
      const count = countRef.current;
      if (count <= 0) return;
      const desired = titleWithBadge(document.title, count);
      if (document.title !== desired) document.title = desired;
    });

    observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Чат отметил прочитанное — пересчитываем сразу, а не через минуту.
    const onChatRead = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("planner:chat-read", onChatRead);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("planner:chat-read", onChatRead);
    };
  }, [refresh]);

  return null;
}
