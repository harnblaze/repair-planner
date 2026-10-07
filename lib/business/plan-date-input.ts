import { isValidDateString } from "./working-days";

// Поле <input type="date"> при вводе с клавиатуры отдаёт промежуточные значения
// года: "0002-…", "0020-…", "0202-…". Такие даты не отправляются на сервер.
const MIN_PLAN_YEAR = 2000;

/** Можно ли сохранять значение поля даты плана: пустое (снять план) или полная дата. */
export function isSubmittablePlanDate(value: string): boolean {
  if (value === "") return true;
  return isValidDateString(value) && Number(value.slice(0, 4)) >= MIN_PLAN_YEAR;
}
