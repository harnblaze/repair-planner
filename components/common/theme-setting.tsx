"use client";

import { useTheme } from "@/components/common/use-theme";
import { Button } from "@/components/ui/button";
import { type ThemeChoice, setThemeChoice } from "@/lib/theme/theme";

// Полный выбор темы: три варианта, включая «как в системе». Живёт в профиле —
// рядом с уведомлениями, которые тоже настраиваются на устройстве.

const OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
  { id: "system", label: "Как в системе" },
];

export function ThemeSetting() {
  const { choice } = useTheme();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">Тема оформления</span>
        <div className="flex items-center gap-1">
          {OPTIONS.map((option) => {
            const active = option.id === choice;
            return (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => setThemeChoice(option.id)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      </div>
      <p className="text-[12px] text-meta">
        Настройка запоминается на этом устройстве. «Как в системе» переключается вместе с
        оформлением телефона или компьютера.
      </p>
    </div>
  );
}
