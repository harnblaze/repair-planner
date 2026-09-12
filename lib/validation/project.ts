import { z } from "zod";

// Часовые пояса, актуальные для мастерских в России. Ограниченный список вместо
// свободного ввода — исключает опечатки и невалидные IANA-идентификаторы на клиенте
// (сервер и БД всё равно валидируют значение независимо, см. supabase/migrations/0002).
export const RUSSIAN_TIMEZONES = [
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
] as const;

const timezone = z.enum(RUSSIAN_TIMEZONES.map((tz) => tz.value) as [string, ...string[]], {
  error: "Выберите часовой пояс",
});

export const projectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Введите название проекта")
    .max(120, "Название слишком длинное"),
  timezone,
});

export type ProjectInput = z.infer<typeof projectSchema>;
