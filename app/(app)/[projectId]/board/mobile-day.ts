/**
 * Какой день доска показывает на телефоне.
 *
 * До md видна одна колонка вместо пяти-шести: открываем на «сегодня», если он
 * в этой неделе, иначе на первом дне недели. Отдельный модуль, потому что
 * выбор проверяется тестом, а не глазами в браузере.
 */

/** Стартовый день недели: сегодня, если он в списке, иначе первый день. */
export function initialActiveDay(weekDates: readonly string[], today: string): string | null {
  if (weekDates.length === 0) return null;
  return weekDates.includes(today) ? today : weekDates[0];
}

/**
 * Активный день с учётом переключения недели: выбранный пользователем день
 * сохраняется, пока он есть в показанной неделе; иначе снова «сегодня».
 * Без этого при переходе на другую неделю осталась бы пустота — выбранной
 * даты там нет.
 */
export function resolveActiveDay(
  weekDates: readonly string[],
  today: string,
  chosen: string | null,
): string | null {
  if (chosen !== null && weekDates.includes(chosen)) return chosen;
  return initialActiveDay(weekDates, today);
}
