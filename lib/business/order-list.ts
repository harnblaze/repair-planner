// Системный список доски «Материалы к заказу» и пункты, которые в него попадают
// из списка материалов. Чистые функции — без серверных и клиентских импортов.

import { csvNumber } from "./csv";
import { parseOrderItem } from "./omts-request";

/** Список «Материалы к заказу» определяется по названию системного списка (как в docs/redesign.md §6). */
export function isOrderList(name: string, isSystem: boolean): boolean {
  return isSystem && /материал/i.test(name);
}

/** Заголовок пункта: «Электроды МР-3 - 20 кг» — его же разбирает parseOrderItem для заявки в ОМТС. */
export function orderItemTitle(name: string, quantity: number, unit: string): string {
  return `${name.trim()} - ${csvNumber(quantity)} ${unit.trim()}`;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("ru");
}

/** Материал уже в заказе, если название невыполненного пункта (до « - кол-во ед.») совпадает с ним. */
export function isMaterialInOrder(materialName: string, openItemTitles: string[]): boolean {
  const target = normalizeName(materialName);
  return openItemTitles.some((title) => normalizeName(parseOrderItem(title, null).name) === target);
}

/** Сколько не хватает до минимума; null — предложить нечего. */
export function suggestedOrderQuantity(balance: number, minimum: number): number | null {
  const value = Number(Math.max(minimum - balance, 0).toFixed(3));
  return value > 0 ? value : null;
}
