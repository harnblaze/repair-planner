"use client";

import { MoonIcon, SunIcon } from "@/components/common/icons";
import { setThemeChoice } from "@/lib/theme/theme";

import { useTheme } from "./use-theme";

// Быстрое переключение в шапке: одно нажатие переключает то, что видно сейчас.
// Полный выбор (в том числе «как в системе») — в профиле.

export function ThemeToggle() {
  const { resolved } = useTheme();
  const dark = resolved === "dark";

  return (
    <button
      type="button"
      // min-h-10: на телефоне палец должен попадать в кнопку, а не в щель между ней и шапкой.
      className="flex size-10 items-center justify-center rounded-md text-icon transition-colors duration-120 hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={dark ? "Светлая тема" : "Тёмная тема"}
      onClick={() => setThemeChoice(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}
