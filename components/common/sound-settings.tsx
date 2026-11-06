"use client";

import { useCallback, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DEFAULT_VOLUME,
  MIN_VOLUME,
  SOUND_OPTIONS,
  type SoundId,
  parseSoundChoice,
  parseSoundVolume,
  playNotificationSound,
  readSoundChoice,
  readSoundVolume,
  writeSoundChoice,
  writeSoundVolume,
} from "@/lib/notifications/sound";

// Звук нового сообщения — настройка устройства (телефон в цеху и компьютер в
// кабинете могут требовать разного), поэтому живёт в localStorage, а не в базе.
// Оба значения читаются через useSyncExternalStore: единственный источник
// изменений — само хранилище и события planner:sound-*.

function subscribe(onChange: () => void): () => void {
  window.addEventListener("planner:sound-changed", onChange);
  window.addEventListener("planner:sound-volume-changed", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("planner:sound-changed", onChange);
    window.removeEventListener("planner:sound-volume-changed", onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function SoundSettings() {
  const choice = useSyncExternalStore(subscribe, readSoundChoice, () => "synth" as SoundId);
  const volume = useSyncExternalStore(subscribe, readSoundVolume, () => DEFAULT_VOLUME);

  // Выбрали вариант — сразу слышно, что именно выбрали: молчаливая настройка
  // звука раздражает, потому что непонятно, сохранилось ли.
  const choose = useCallback(
    (next: SoundId) => {
      writeSoundChoice(next);
      playNotificationSound(next, readSoundVolume() / 100);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-2.5 border-t border-line-strong pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">Звук новых сообщений</span>
        <div className="flex items-center gap-1.5">
          <NativeSelect
            aria-label="Звук уведомлений"
            value={choice}
            wrapperClassName="w-[132px]"
            onChange={(event) => choose(parseSoundChoice(event.target.value))}
          >
            {SOUND_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={choice === "off"}
            onClick={() => playNotificationSound(choice, volume / 100)}
          >
            Проверить
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-soft">Громкость</span>
        <input
          type="range"
          aria-label="Громкость звука"
          min={MIN_VOLUME}
          max={100}
          step={5}
          value={volume}
          disabled={choice === "off"}
          onChange={(event) => writeSoundVolume(parseSoundVolume(event.target.value))}
          className="h-[18px] flex-1 accent-brand disabled:opacity-50"
        />
        <span className="w-9 text-right font-mono text-[11.5px] text-meta">{volume}%</span>
      </div>

      <p className="text-[12px] text-meta">
        Короткий звук при новом сообщении в чате, пока приложение открыто. Если приложение
        свёрнуто, звучит уведомление телефона — оно приходит и без этого.
      </p>
    </div>
  );
}
