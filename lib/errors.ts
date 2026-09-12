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
