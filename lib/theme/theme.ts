// Тема оформления: светлая, тёмная или как в системе.
//
// Выбор хранится на устройстве (у телефона в цеху и у компьютера в кабинете
// может быть разное освещение), а применяется классом `dark` на <html>:
// все цвета интерфейса — это CSS-переменные в globals.css, поэтому одного
// класса достаточно.

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/** Цвет строки состояния телефона и рамки браузера под текущую тему. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#141517",
};

/** В хранилище живёт только "light" или "dark"; всё остальное — системная тема. */
export function parseThemeChoice(stored: string | null): ThemeChoice {
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "system") return systemDark ? "dark" : "light";
  return choice;
}

/** Что произойдёт от нажатия кнопки в шапке: переключаем то, что видно сейчас. */
export function toggleTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  return resolveTheme(choice, systemDark) === "dark" ? "light" : "dark";
}

export function themeLabel(choice: ThemeChoice): string {
  if (choice === "dark") return "Тёмная";
  if (choice === "light") return "Светлая";
  return "Как в системе";
}

function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function readSystemDark(): boolean {
  return prefersDark();
}

/** Класс на <html>, color-scheme и цвет строки состояния. */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // color-scheme живёт в CSS (.dark и :root в globals.css) — инлайновый стиль
  // здесь давал расхождение с серверной разметкой при гидратации.
  root.classList.toggle("dark", theme === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

/** Сохранить выбор и сразу применить. */
export function setThemeChoice(choice: ThemeChoice): void {
  if (typeof window === "undefined") return;
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Не сохранилось — тема проживёт до перезагрузки.
  }
  applyTheme(resolveTheme(choice, readSystemDark()));
  window.dispatchEvent(new Event("planner:theme-changed"));
}

/**
 * Скрипт для <head>: считает тему до первой отрисовки. Без него страница
 * успевает мигнуть светлым — на тёмной теме это заметный удар по глазам.
 * Строка минифицирована намеренно: она уходит в HTML целиком.
 */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("theme"),d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.classList.toggle("dark",d);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"#141517":"#ffffff")}catch(e){}})();`;
