import { cn } from "@/lib/utils";

/**
 * Кнопки в правом нижнем углу карточки дня («Завершить», «Перенести»).
 * Позицию задаёт обёртка в week-board.tsx: кнопки идут в ряд.
 */
export function chipCornerButtonClass(pending: boolean): string {
  return cn(
    "flex size-7 items-center justify-center rounded-md text-meta transition-[opacity,color,background-color] duration-120 hover:bg-row-hover hover:text-ink disabled:opacity-50",
    // На компьютере — при наведении на карточку или фокусе; на телефоне наведения нет, кнопка видна всегда.
    "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
    pending && "opacity-100",
  );
}
