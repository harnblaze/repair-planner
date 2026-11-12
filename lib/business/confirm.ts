// Разбор ссылки из письма Supabase Auth (/auth/confirm).
//
// Письмо приходит в одном из трёх видов, и обрабатываются они по-разному:
//
//  • token_hash + type — наш шаблон (supabase/templates/*.html): одноразовый
//    токен проверяет сервер, браузер в разборе ссылки не участвует. Так
//    работает локальная разработка и любой проект со своими шаблонами.
//  • code — шаблон Supabase по умолчанию с PKCE: GoTrue проверяет ссылку сам
//    и возвращает одноразовый код, который нужно обменять на сессию.
//  • ни того, ни другого — implicit-флоу: токены приходят во фрагменте URL
//    (#access_token=…). Фрагмент до сервера не доходит, поэтому его разбирает
//    браузерный клиент, а страница только ждёт появления сессии.
//
// Отдельная чистая функция, а не ветвление внутри страницы: так у решения
// есть тесты, и порядок проверок (сначала явные ошибки, потом токены) виден
// целиком.

export type ConfirmBranch = "otp" | "code" | "hash" | "expired";

export type ConfirmParams = {
  error?: string | null;
  errorDescription?: string | null;
  tokenHash?: string | null;
  type?: string | null;
  code?: string | null;
};

/** Типы токенов, которые принимает supabase.auth.verifyOtp. */
const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Это тип из списка verifyOtp? Строка приходит из адресной строки, ей нельзя верить. */
export function isEmailOtpType(type: string): boolean {
  return OTP_TYPES.has(type);
}

/**
 * Что делать со ссылкой. Явная ошибка (GoTrue умеет возвращать error/
 * error_description вместо токена) важнее любых параметров — иначе можно
 * показать «проверяем ссылку» там, где ссылка уже признана недействительной.
 */
export function confirmBranch(params: ConfirmParams): ConfirmBranch {
  if (trimmed(params.error) || trimmed(params.errorDescription)) return "expired";

  const tokenHash = trimmed(params.tokenHash);
  const type = trimmed(params.type);

  if (tokenHash) return type && isEmailOtpType(type) ? "otp" : "expired";
  if (type) return "expired";

  // Пустой code — это присланный, но не сработавший код, а не его отсутствие:
  // иначе страница молча ушла бы ждать токены во фрагменте, которых нет.
  if (params.code !== null && params.code !== undefined) {
    return trimmed(params.code) ? "code" : "expired";
  }

  return "hash";
}

/**
 * Разворот вложенного next.
 *
 * Наши шаблоны писем передают в next адрес возврата целиком
 * ({{ .RedirectTo }} — это https://домен/auth/confirm?next=/reset-password),
 * поэтому после проверки «чужого хоста» в next остаётся наш же /auth/confirm
 * с внутренним next. Без разворота страница ушла бы сама на себя и потеряла
 * адрес назначения.
 *
 * Возвращает путь, который безопасно отдать redirect: вложенный next проходит
 * ту же проверку, что и обычный (только путь этого сайта).
 */
export function unwrapConfirmNext(path: string, safeNext: (value: string | null) => string): string {
  let current = path;

  // Три уровня хватает: вложенность возникает только из шаблона письма.
  for (let depth = 0; depth < 3; depth++) {
    let url: URL;
    try {
      url = new URL(current, "http://local");
    } catch {
      return current;
    }

    if (url.pathname !== "/auth/confirm") return current;

    const inner = url.searchParams.get("next");
    if (!inner) return current;

    const next = safeNext(inner);
    // safeNext вернул тот же адрес — ссылка ссылается сама на себя; уходим на
    // запасной путь, иначе страница зациклится на себе.
    if (next === current) return safeNext(null);
    current = next;
  }

  // Слишком глубокая вложенность — тоже повод не гадать, а взять запасной путь.
  return safeNext(null);
}
