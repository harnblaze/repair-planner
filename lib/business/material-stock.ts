// Состояние остатка материала (CLAUDE.md §25: остаток ≤ минимума — предупреждение)
// и фильтр списка материалов. Один источник правды для бейджа и фильтра «Мало».

export type BalanceState = "negative" | "low" | "ok";

/** Отрицательный — допустимое бизнес-состояние, а не ошибка (docs/redesign.md §6). */
export function balanceState(balance: number, minimumBalance: number): BalanceState {
  if (balance < 0) return "negative";
  if (balance <= minimumBalance) return "low";
  return "ok";
}

type StockItem = { name: string; current_balance: number; minimum_balance: number };

function needsRestock(material: StockItem): boolean {
  return balanceState(material.current_balance, material.minimum_balance) !== "ok";
}

export function countNeedingRestock(materials: StockItem[]): number {
  return materials.filter(needsRestock).length;
}

/**
 * Поиск — подстрока названия без учёта регистра; `onlyRestock` оставляет
 * материалы с низким или отрицательным остатком. Материалов в проекте немного,
 * поэтому фильтруем в браузере, без запросов.
 */
export function filterMaterials<T extends StockItem>(
  materials: T[],
  { query, onlyRestock }: { query: string; onlyRestock: boolean },
): T[] {
  const q = query.trim().toLocaleLowerCase("ru");
  return materials.filter(
    (m) => (!q || m.name.toLocaleLowerCase("ru").includes(q)) && (!onlyRestock || needsRestock(m)),
  );
}
