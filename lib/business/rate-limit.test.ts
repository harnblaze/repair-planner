import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeRateLimit, rateLimitBucketCount, resetRateLimits } from "@/lib/business/rate-limit";

const WINDOW = 60_000;

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimits();
  });

  it("пропускает в пределах лимита и отказывает следующему", () => {
    for (let i = 0; i < 20; i++) {
      expect(consumeRateLimit("chat:send:u1", 20, WINDOW)).toEqual({ ok: true });
    }

    const denied = consumeRateLimit("chat:send:u1", 20, WINDOW);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterMs).toBe(WINDOW);
  });

  it("сбрасывает счёт, когда окно истекло", () => {
    for (let i = 0; i < 20; i++) consumeRateLimit("chat:send:u1", 20, WINDOW);
    expect(consumeRateLimit("chat:send:u1", 20, WINDOW).ok).toBe(false);

    vi.advanceTimersByTime(WINDOW + 1);

    expect(consumeRateLimit("chat:send:u1", 20, WINDOW)).toEqual({ ok: true });
  });

  it("уменьшает retryAfterMs по мере ожидания", () => {
    for (let i = 0; i < 5; i++) consumeRateLimit("k", 5, WINDOW);

    const first = consumeRateLimit("k", 5, WINDOW);
    vi.advanceTimersByTime(20_000);
    const second = consumeRateLimit("k", 5, WINDOW);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (!first.ok && !second.ok) {
      expect(first.retryAfterMs).toBe(WINDOW);
      expect(second.retryAfterMs).toBe(WINDOW - 20_000);
    }
  });

  it("считает разные ключи независимо", () => {
    for (let i = 0; i < 20; i++) consumeRateLimit("chat:send:u1", 20, WINDOW);

    expect(consumeRateLimit("chat:send:u1", 20, WINDOW).ok).toBe(false);
    expect(consumeRateLimit("chat:send:u2", 20, WINDOW)).toEqual({ ok: true });
  });

  it("лимит 1 пропускает один раз за окно", () => {
    expect(consumeRateLimit("access-denied:u1:p1", 1, WINDOW)).toEqual({ ok: true });
    expect(consumeRateLimit("access-denied:u1:p1", 1, WINDOW).ok).toBe(false);
  });

  it("не копит просроченные ключи — чистка при вызовах", () => {
    // Ключи живут по секунде, время двигаем вперёд по 10 мс: к концу цикла
    // создано 1000 ключей, но живых из них — только те, что попали в
    // последнюю секунду. Если бы чистки не было, в Map лежали бы все 1000.
    for (let i = 0; i < 1_000; i++) {
      consumeRateLimit(`short:${i}`, 1, 1_000);
      vi.advanceTimersByTime(10);
    }

    // Плюс-минус сотня: 1 секунда окна при шаге 10 мс.
    expect(rateLimitBucketCount()).toBeLessThan(200);
  });
});
