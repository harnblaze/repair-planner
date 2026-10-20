// Подписи чисел и дат на странице «Снабжение».

const quantityFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const moneyFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1500 → «1 500», 5.2 → «5,2». */
export const formatQuantity = (value: number) => quantityFormat.format(value);

/** 123141.44 → «123 141,44 ₽». */
export const formatMoney = (value: number) => `${moneyFormat.format(value)} ₽`;

/** "2026-10-01" → «01.10.2026». */
export function formatDocDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}
