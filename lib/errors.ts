const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "Invalid login credentials": "Неверный email или пароль.",
  "User already registered": "Пользователь с таким email уже зарегистрирован.",
  "Email not confirmed": "Email не подтверждён. Проверьте почту.",
  "Password should be at least 6 characters": "Пароль должен содержать не менее 6 символов.",
  "same_password": "Новый пароль должен отличаться от старого.",
  "Auth session missing!": "Сессия истекла. Запросите восстановление пароля ещё раз.",
};

const DEFAULT_MESSAGE = "Не удалось выполнить операцию. Попробуйте ещё раз.";

/**
 * Переводит технические сообщения Supabase Auth в понятные пользователю.
 * Технические детали должны попадать в логи, а не пользователю (CLAUDE.md §31).
 */
export function mapAuthError(message: string | undefined | null): string {
  if (!message) return DEFAULT_MESSAGE;
  return AUTH_ERROR_MESSAGES[message] ?? DEFAULT_MESSAGE;
}

/** Код ошибки PostgreSQL при нарушении unique-ограничения. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

// Коды исключений RPC перемещения на доске (supabase/migrations/0008).
const BOARD_MOVE_ERROR_MESSAGES: Record<string, string> = {
  not_working_day: "Планировать можно только на рабочий день (Пн–Пт).",
  task_not_found: "Заявка не найдена. Обновите страницу.",
  task_closed: "Завершённую или отменённую заявку нельзя вернуть в текущие заявки.",
  task_already_planned: "Заявка уже запланирована. Обновите страницу.",
  task_not_planned: "Заявка уже в текущих заявках. Обновите страницу.",
  date_before_history:
    "Нельзя запланировать раньше последнего дня, в который над заявкой уже работали.",
  task_has_history:
    "Перенесённую заявку можно только упорядочить внутри дня. Дату можно изменить в карточке заявки.",
  schedule_not_found: "Заявка не найдена в этом дне. Обновите страницу.",
  item_not_found: "Запись не найдена. Обновите страницу.",
};

/**
 * Переводит код исключения RPC перемещения в понятное сообщение.
 * Неизвестная ошибка — общий текст; детали остаются в логах сервера.
 */
export function mapBoardMoveError(message: string | undefined | null): string {
  return (message && BOARD_MOVE_ERROR_MESSAGES[message]) || "Не удалось переместить. Попробуйте ещё раз.";
}
