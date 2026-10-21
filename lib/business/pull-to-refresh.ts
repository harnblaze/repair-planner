// Жест «потяни вниз — обновить» для установленного приложения (PWA): чистая
// логика без DOM. Подключается в components/common/pull-to-refresh.tsx.

/** Порог: визуальное смещение индикатора (px), с которого отпускание обновляет страницу. */
export const PULL_THRESHOLD = 70;
/** Предел смещения индикатора (px): дальше тянуть некуда. */
export const PULL_MAX = 120;
/** Через сколько px движения определяется направление жеста. */
export const DIRECTION_LOCK_PX = 10;

/** Начальная «упругость»: смещение на первых пикселях = 0.8 от движения пальца. */
const RESISTANCE = 0.8;

/**
 * Смещение индикатора по пути пальца вниз: сначала почти 1:1, дальше всё
 * тяжелее, к PULL_MAX асимптотически. Вверх и на месте — 0.
 */
export function pullDistance(rawDy: number): number {
  if (rawDy <= 0) return 0;
  return PULL_MAX * (1 - Math.exp((-rawDy * RESISTANCE) / PULL_MAX));
}

export function shouldRefresh(visualDistance: number): boolean {
  return visualDistance >= PULL_THRESHOLD;
}

export type PullDirection = "pending" | "pull" | "ignore";

/**
 * Направление жеста по сдвигу от точки касания. Тянуть — только заметно
 * вертикальное движение вниз; горизонтальное (таблицы, доска), диагональное и
 * движение вверх — обычная прокрутка, жест игнорируется целиком.
 */
export function lockDirection(dx: number, dy: number): PullDirection {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < DIRECTION_LOCK_PX) return "pending";
  return dy > 0 && absY > absX ? "pull" : "ignore";
}

export type PullStartContext = {
  /** Сколько пальцев на экране. */
  touchCount: number;
  /** Прокрутка страницы. */
  scrollY: number;
  /** Открыто окно, меню или список, либо прокрутка страницы заблокирована. */
  overlayOpen: boolean;
  /** Касание внутри поля ввода. */
  inEditable: boolean;
  /** Касание внутри блока, который сам прокручивается по вертикали и уже прокручен вниз. */
  scrolledAncestor: boolean;
  /** Идёт перетаскивание на доске. */
  dragActive: boolean;
  /** Касание стилусом. */
  stylus: boolean;
};

/** Можно ли начинать жест: страница в самом верху, один палец, ничего не мешает. */
export function canStartPull(ctx: PullStartContext): boolean {
  return (
    ctx.touchCount === 1 &&
    ctx.scrollY <= 0 &&
    !ctx.overlayOpen &&
    !ctx.inEditable &&
    !ctx.scrolledAncestor &&
    !ctx.dragActive &&
    !ctx.stylus
  );
}

/**
 * Атрибут на <html>, пока на доске идёт перетаскивание: жест обновления в это
 * время не начинается и прерывается (app/(app)/[projectId]/board/dnd.ts).
 */
export const DRAG_ACTIVE_ATTRIBUTE = "data-dnd-active";
