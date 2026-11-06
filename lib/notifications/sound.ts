// Звук нового сообщения: несколько готовых вариантов на выбор.
//
// Файлы — из свободного набора Kenney Interface Sounds (CC0), обрезаны и
// выровнены по громкости, см. public/sounds/LICENSE.md. Синтезированный
// «Стандартный» остаётся по умолчанию: он не требует загрузки и звучит
// одинаково на любом устройстве.
//
// Браузер не даёт играть звук до первого действия пользователя (политика
// автозапуска): контекст создаётся лениво и «разблокируется» на первом клике
// или нажатии клавиши. До этого момента звук просто не сыграет — это нормально
// и не считается ошибкой.

/** Ключ настройки в localStorage: id варианта или "off". */
export const SOUND_STORAGE_KEY = "notifications:sound";

export type SoundId = "synth" | "soft" | "pop" | "pluck" | "glass" | "switch" | "bong" | "off";

export type SoundOption = {
  id: SoundId;
  /** Подпись для выбора в профиле. */
  label: string;
  /** Файл в public/; у синтезированного варианта его нет. */
  file?: string;
};

export const SOUND_OPTIONS: readonly SoundOption[] = [
  { id: "synth", label: "Стандартный" },
  { id: "soft", label: "Мягкий", file: "/sounds/soft.mp3" },
  { id: "pop", label: "Всплытие", file: "/sounds/pop.mp3" },
  { id: "pluck", label: "Щипок", file: "/sounds/pluck.mp3" },
  { id: "glass", label: "Стекло", file: "/sounds/glass.mp3" },
  { id: "switch", label: "Двойной", file: "/sounds/switch.mp3" },
  { id: "bong", label: "Низкий", file: "/sounds/bong.mp3" },
  { id: "off", label: "Без звука" },
];

const DEFAULT_CHOICE: SoundId = "synth";

/**
 * Разбор сохранённого значения. Старые записи («1» — включено, «0» — выключено)
 * читаются как прежде: настройка не должна слетать после обновления.
 */
export function parseSoundChoice(stored: string | null): SoundId {
  if (stored === null) return DEFAULT_CHOICE;
  if (stored === "0" || stored === "off") return "off";
  if (stored === "1") return DEFAULT_CHOICE;
  const known = SOUND_OPTIONS.some((option) => option.id === stored);
  return known ? (stored as SoundId) : DEFAULT_CHOICE;
}

export function readSoundChoice(): SoundId {
  if (typeof window === "undefined") return DEFAULT_CHOICE;
  try {
    return parseSoundChoice(window.localStorage.getItem(SOUND_STORAGE_KEY));
  } catch {
    // Приватный режим без хранилища — стандартный звук.
    return DEFAULT_CHOICE;
  }
}

export function writeSoundChoice(choice: SoundId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, choice);
  } catch {
    // Не сохранилось — настройка проживёт до перезагрузки.
  }
  window.dispatchEvent(new Event("planner:sound-changed"));
}

/** Ключ громкости в localStorage: целое 10..100 (проценты). */
export const VOLUME_STORAGE_KEY = "notifications:volume";

/** Тише 10% — уже не уведомление, а шорох; выключить можно вариантом «Без звука». */
export const MIN_VOLUME = 10;
export const DEFAULT_VOLUME = 100;

/** Громкость из хранилища: целые проценты в допустимых границах. */
export function parseSoundVolume(stored: string | null): number {
  // Пустая строка — не ноль: Number("") даёт 0, и громкость молча падала бы
  // до минимума. Пустое значение читаем как «не настроено».
  if (stored === null || stored.trim() === "") return DEFAULT_VOLUME;
  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
  return Math.min(100, Math.max(MIN_VOLUME, Math.round(parsed)));
}

export function readSoundVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    return parseSoundVolume(window.localStorage.getItem(VOLUME_STORAGE_KEY));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function writeSoundVolume(percent: number): void {
  if (typeof window === "undefined") return;
  const value = parseSoundVolume(String(percent));
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
  } catch {
    // Не сохранилось — настройка проживёт до перезагрузки.
  }
  window.dispatchEvent(new Event("planner:sound-volume-changed"));
}

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

function optionFor(choice: SoundId): SoundOption | undefined {
  return SOUND_OPTIONS.find((option) => option.id === choice);
}

/** Заранее загрузить и раскодировать файл: первый сигнал не должен опаздывать. */
async function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return cached;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    buffers.set(url, buffer);
    return buffer;
  } catch {
    return null;
  }
}

function playBuffer(ctx: AudioContext, buffer: AudioBuffer, volume: number): void {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

function tone(ctx: AudioContext, frequency: number, startAt: number, duration: number, peak: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);

  // Быстрая атака и плавное затухание: резкий старт на телефоне звучит как
  // брак, а не как уведомление.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/** Стандартный (синтезированный) сигнал: два тона, без загрузки файла. */
function playSynth(ctx: AudioContext, volume: number): void {
  const now = ctx.currentTime + 0.01;
  // Два тона подряд: короткий верхний и чуть ниже — узнаваемо и не режет слух.
  // Громкость поднята по опыту: на телефоне в цеху 0.045 было почти не слышно,
  // а выше 0.2 сигнал начинает «квакать» на встроенном динамике.
  tone(ctx, 1046.5, now, 0.11, 0.18 * volume);
  tone(ctx, 783.99, now + 0.09, 0.17, 0.14 * volume);
}

/** Разблокировать звук на первом действии пользователя и подгрузить выбранный. */
export function unlockNotificationSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  const option = optionFor(readSoundChoice());
  if (option?.file) void loadBuffer(ctx, option.file);
}

/**
 * Сыграть сигнал. `choice` — для предпросмотра в настройках, иначе берётся
 * сохранённая настройка. «Без звука» — молча ничего не делает.
 */
export function playNotificationSound(
  choice: SoundId = readSoundChoice(),
  volume: number = readSoundVolume() / 100,
): void {
  if (choice === "off") return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  if (choice === "synth") {
    playSynth(ctx, volume);
    return;
  }

  const option = optionFor(choice);
  if (!option?.file) return;

  const cached = buffers.get(option.file);
  if (cached) {
    playBuffer(ctx, cached, volume);
    return;
  }

  // Файл ещё не загружен (первый сигнал или только что выбранный вариант):
  // проигрываем сразу после загрузки.
  void loadBuffer(ctx, option.file).then((buffer) => {
    if (buffer) playBuffer(ctx, buffer, volume);
  });
}
