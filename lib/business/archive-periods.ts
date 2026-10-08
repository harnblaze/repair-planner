// Быстрые периоды фильтра архива. today — "YYYY-MM-DD" в timezone проекта
// (todayInTimezone); считаем на строках и UTC, без часового пояса браузера.

export function monthRange(today: string, offset: 0 | -1): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  // День 0 следующего месяца — последний день этого.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}
