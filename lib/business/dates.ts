// Работа с датами всегда в timezone проекта, а не сервера/браузера (CLAUDE.md §32).
// Формат хранения и передачи — "YYYY-MM-DD" (соответствует типу `date` в PostgreSQL).

/** "Сегодня" в IANA timezone проекта, а не в timezone сервера. */
export function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

const MONTHS_RU_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** "14.09" — короткая подпись для заголовков колонок доски. */
export function formatDateShort(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${day}.${month}`;
}

/** "14 сентября" — для карточки задачи и подтверждений. */
export function formatDateLong(dateStr: string): string {
  const [, month, day] = dateStr.split("-").map(Number);
  return `${day} ${MONTHS_RU_GENITIVE[month - 1]}`;
}

/** "14 сентября 2026, 09:30" — момент (timestamptz) в timezone проекта, для истории движений. */
export function formatDateTime(isoTimestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoTimestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";

  return `${formatDateLong(`${part("year")}-${part("month")}-${part("day")}`)} ${part("year")}, ${part("hour")}:${part("minute")}`;
}
