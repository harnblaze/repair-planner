"use client";

import { ArrowDownIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  DRAG_ACTIVE_ATTRIBUTE,
  PULL_THRESHOLD,
  canStartPull,
  lockDirection,
  pullDistance,
  shouldRefresh,
} from "@/lib/business/pull-to-refresh";

const STANDALONE_QUERY = "(display-mode: standalone)";
// Открытое окно или меню: тянуть страницу под ними нельзя.
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]';
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// Высота индикатора (h-9) и зазор до верхнего края, пока он спрятан.
const INDICATOR_HIDDEN_OFFSET = 40;

function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// iOS Safari: «На экран „Домой“» отдаёт navigator.standalone, display-mode — не везде.
function getStandalone() {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isOverlayOpen() {
  const { body, documentElement } = document;
  return (
    document.querySelector(OVERLAY_SELECTOR) !== null ||
    body.hasAttribute("data-scroll-locked") ||
    getComputedStyle(body).overflow === "hidden" ||
    getComputedStyle(documentElement).overflow === "hidden"
  );
}

/** Есть ли у цели касания предок с собственной вертикальной прокруткой, уже прокрученной вниз. */
function hasScrolledAncestor(target: Element | null) {
  for (let node = target; node && node !== document.documentElement; node = node.parentElement) {
    if (node.scrollTop <= 0) continue;
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return true;
  }
  return false;
}

/**
 * «Потяни вниз — обновить» для установленного приложения: в режиме standalone у
 * браузера нет ни кнопки перезагрузки, ни своего жеста. Работает только касанием
 * одним пальцем со страницы, прокрученной до самого верха; отпускание дальше
 * порога делает полную перезагрузку (заодно подхватывается новая версия
 * приложения после деплоя). В обычной вкладке ничего не рисует и не слушает.
 */
export function PullToRefresh() {
  const standalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => false);
  const [refreshing, setRefreshing] = useState(false);
  const indicator = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!standalone) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let phase: "idle" | "pending" | "pull" | "ignore" = "idle";
    let startX = 0;
    let startY = 0;
    let busy = false;

    const paint = (distance: number, animate: boolean) => {
      const circle = indicator.current;
      if (!circle) return;
      const transition = animate && !reducedMotion.matches ? "transform 200ms ease, opacity 200ms ease" : "none";
      circle.style.transition = transition;
      circle.style.transform = `translateY(${distance - INDICATOR_HIDDEN_OFFSET}px)`;
      circle.style.opacity = String(Math.min(1, distance / (PULL_THRESHOLD / 2)));
      if (arrow.current) {
        arrow.current.style.transition = transition === "none" ? "none" : "transform 150ms ease";
        arrow.current.style.transform = `rotate(${shouldRefresh(distance) ? 180 : 0}deg)`;
      }
    };

    const abort = () => {
      if (phase === "pull") paint(0, true);
      phase = "ignore";
    };

    const onTouchStart = (event: TouchEvent) => {
      phase = "idle";
      if (busy) return;
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target : null;
      const allowed =
        touch !== undefined &&
        canStartPull({
          touchCount: event.touches.length,
          scrollY: window.scrollY,
          overlayOpen: isOverlayOpen(),
          inEditable: target?.closest(EDITABLE_SELECTOR) != null,
          scrolledAncestor: hasScrolledAncestor(target),
          dragActive: document.documentElement.hasAttribute(DRAG_ACTIVE_ATTRIBUTE),
          stylus: (touch as Touch & { touchType?: string }).touchType === "stylus",
        });
      if (!allowed) {
        phase = "ignore";
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      phase = "pending";
    };

    const onTouchMove = (event: TouchEvent) => {
      if (phase !== "pending" && phase !== "pull") return;
      // Второй палец, начавшееся перетаскивание карточки (dnd-kit гасит touchmove
      // сам) или прокрутка страницы — жест отменяется.
      if (
        event.touches.length !== 1 ||
        event.defaultPrevented ||
        document.documentElement.hasAttribute(DRAG_ACTIVE_ATTRIBUTE) ||
        window.scrollY > 0
      ) {
        abort();
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (phase === "pending") {
        const direction = lockDirection(dx, dy);
        if (direction === "pending") return;
        if (direction === "ignore") {
          phase = "ignore";
          return;
        }
        phase = "pull";
      }

      // Гасим прокрутку и «резинку» браузера только пока тянем: обычная
      // прокрутка остаётся плавной.
      if (event.cancelable) event.preventDefault();
      paint(pullDistance(dy), false);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (phase !== "pull") {
        phase = "idle";
        return;
      }
      phase = "idle";
      const touch = event.changedTouches[0];
      const distance = touch ? pullDistance(touch.clientY - startY) : 0;
      if (!shouldRefresh(distance)) {
        paint(0, true);
        return;
      }
      busy = true;
      paint(PULL_THRESHOLD, true);
      setRefreshing(true);
      window.location.reload();
    };

    const onTouchCancel = () => {
      if (phase === "pull") paint(0, true);
      phase = "idle";
    };

    // На window, а не на document: слушатель dnd-kit стоит на document и срабатывает
    // раньше, так что defaultPrevented уже выставлен. passive: false нужен для
    // preventDefault.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [standalone]);

  if (!standalone) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-[env(safe-area-inset-top)]"
    >
      <div
        ref={indicator}
        className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-surface text-brand shadow-md"
        style={{ opacity: 0, transform: `translateY(-${INDICATOR_HIDDEN_OFFSET}px)` }}
      >
        {refreshing ? (
          <Loader2Icon className="size-5 motion-safe:animate-spin" />
        ) : (
          <ArrowDownIcon ref={arrow} className="size-5" />
        )}
      </div>
    </div>
  );
}
