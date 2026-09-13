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

export const NOT_WORKING_DAY_MESSAGE = "Этот день нерабочий. Выберите рабочий день.";

// Коды исключений RPC перемещения и переноса на доске (supabase/migrations/0008, 0013).
const BOARD_MOVE_ERROR_MESSAGES: Record<string, string> = {
  not_working_day: NOT_WORKING_DAY_MESSAGE,
  no_working_day: "В календаре проекта не найден следующий рабочий день.",
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

// Коды исключений RPC прихода и корректировки (supabase/migrations/0010).
const MATERIAL_MOVEMENT_ERROR_MESSAGES: Record<string, string> = {
  invalid_quantity: "Проверьте количество.",
  material_not_found: "Материал не найден. Обновите страницу.",
  balance_unchanged: "Остаток уже равен указанному значению.",
  access_denied: "Недостаточно прав для изменения данных проекта.",
};

/** Переводит код исключения RPC движения материала в понятное сообщение. */
export function mapMaterialMovementError(message: string | undefined | null): string {
  return (
    (message && MATERIAL_MOVEMENT_ERROR_MESSAGES[message]) ||
    "Не удалось сохранить движение материала. Попробуйте ещё раз."
  );
}

// Коды исключений RPC приглашений (supabase/migrations/0012).
const INVITATION_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Приглашать участников может только владелец проекта.",
  invalid_role: "Выберите роль участника.",
  invitation_not_found: "Приглашение не найдено. Попросите владельца проекта прислать новую ссылку.",
  invitation_used: "Это приглашение уже использовано. Попросите владельца проекта прислать новую ссылку.",
  invitation_expired: "Срок действия приглашения истёк. Попросите владельца проекта прислать новую ссылку.",
};

/** Переводит код исключения RPC приглашения в понятное сообщение. */
export function mapInvitationError(message: string | undefined | null): string {
  return (
    (message && INVITATION_ERROR_MESSAGES[message]) ||
    "Не удалось выполнить операцию с приглашением. Попробуйте ещё раз."
  );
}
