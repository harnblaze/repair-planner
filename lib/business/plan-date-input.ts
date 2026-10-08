import { isValidDateString } from "./working-days";

// Поле <input type="date"> при вводе с клавиатуры отдаёт промежуточные значения
// года: "0002-…", "0020-…", "0202-…". Такие даты не отправляются на сервер.
// Пустое значение тоже не отправляется: Chrome отдаёт его и при стирании одного
// сегмента даты. Снять план — отдельная кнопка «Вернуть в «Текущие заявки»».
const MIN_PLAN_YEAR = 2000;

/** Можно ли сохранять значение поля даты плана: только полная дата. */
export function isSubmittablePlanDate(value: string): boolean {
  return isValidDateString(value) && Number(value.slice(0, 4)) >= MIN_PLAN_YEAR;
}
