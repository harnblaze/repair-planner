// История движений материала (docs/database.md §7.1): подписи типов и
// остаток после каждого движения для экрана материала.

import type { Database } from "@/lib/types/database";

export type MovementKind = Database["public"]["Enums"]["movement_kind"];

/**
 * Подпись движения. Корректировка, связанная с заявкой, — это правка строки
 * расхода в задаче, а не ручная корректировка остатка, и подписывается иначе.
 */
export function movementLabel(kind: MovementKind, taskId: string | null): string {
  switch (kind) {
    case "receipt":
      return "Приход";
    case "consumption":
      return "Списание";
    case "adjustment":
      return taskId ? "Правка расхода" : "Корректировка";
  }
}

// numeric(14, 3) приходит числом JS: считаем в тысячных, чтобы сумма
// 0.1 + 0.2 не превращалась в 0.30000000000000004.
const toThousandths = (value: number) => Math.round(value * 1000);

/**
 * Остаток после каждого движения. Движения — от новых к старым, как на экране.
 * Любое изменение current_balance записывается в журнал (триггер-страж 0003),
 * поэтому остаток после движения = текущий − сумма всех более новых движений.
 * Нужна только загруженная страница: более старые движения на результат не влияют.
 */
export function withBalanceAfter<T extends { quantity: number }>(
  currentBalance: number,
  movements: T[],
): (T & { balanceAfter: number })[] {
  let balance = toThousandths(currentBalance);
  return movements.map((movement) => {
    const balanceAfter = balance / 1000;
    balance -= toThousandths(movement.quantity);
    return { ...movement, balanceAfter };
  });
}
