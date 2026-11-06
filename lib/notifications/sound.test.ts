import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOLUME,
  MIN_VOLUME,
  SOUND_OPTIONS,
  SOUND_STORAGE_KEY,
  parseSoundChoice,
  parseSoundVolume,
} from "./sound";

describe("parseSoundChoice", () => {
  it("по умолчанию — стандартный звук", () => {
    expect(parseSoundChoice(null)).toBe("synth");
  });

  it("понимает новые значения из списка", () => {
    for (const option of SOUND_OPTIONS) {
      expect(parseSoundChoice(option.id)).toBe(option.id);
    }
  });

  it("старые записи не слетают: «1» — включено, «0» — выключено", () => {
    expect(parseSoundChoice("1")).toBe("synth");
    expect(parseSoundChoice("0")).toBe("off");
  });

  it("мусор в хранилище не ломает настройку", () => {
    expect(parseSoundChoice("gong")).toBe("synth");
    expect(parseSoundChoice("")).toBe("synth");
  });

  it("ключ настройки стабилен — по нему читают другие экраны", () => {
    expect(SOUND_STORAGE_KEY).toBe("notifications:sound");
  });

  it("в списке есть «без звука» и хотя бы три варианта", () => {
    expect(SOUND_OPTIONS.some((option) => option.id === "off")).toBe(true);
    expect(SOUND_OPTIONS.filter((option) => option.file).length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseSoundVolume", () => {
  it("пустое значение — полная громкость", () => {
    expect(parseSoundVolume(null)).toBe(DEFAULT_VOLUME);
    expect(parseSoundVolume("")).toBe(DEFAULT_VOLUME);
    expect(parseSoundVolume("громко")).toBe(DEFAULT_VOLUME);
  });

  it("нормальные значения читаются как есть", () => {
    expect(parseSoundVolume("100")).toBe(100);
    expect(parseSoundVolume("55")).toBe(55);
    expect(parseSoundVolume("10")).toBe(10);
  });

  it("границы держатся: тише 10% и выше 100% не бывает", () => {
    expect(parseSoundVolume("0")).toBe(MIN_VOLUME);
    expect(parseSoundVolume("-40")).toBe(MIN_VOLUME);
    expect(parseSoundVolume("250")).toBe(100);
  });

  it("дробное округляется — в интерфейсе целые проценты", () => {
    expect(parseSoundVolume("55.6")).toBe(56);
  });
});
