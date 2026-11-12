import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSignedUrlCache, getCachedSignedUrl, rememberSignedUrl } from "./signed-url-cache";

// Кэш живёт в модуле, поэтому между тестами его надо чистить — иначе один тест
// увидит ссылку, запомненную другим.
beforeEach(() => {
  clearSignedUrlCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signed url cache", () => {
  it("returns null for an unknown key", () => {
    expect(getCachedSignedUrl("chat/photo.jpg")).toBeNull();
  });

  it("returns a remembered url", () => {
    rememberSignedUrl("chat/photo.jpg", "https://storage/photo?token=1", 3600);
    expect(getCachedSignedUrl("chat/photo.jpg")).toBe("https://storage/photo?token=1");
  });

  it("keeps the url for ttl minus the 10 minute reserve", () => {
    rememberSignedUrl("chat/photo.jpg", "https://storage/photo?token=1", 3600);

    // 3600 − 600 = 3000 секунд в кэше.
    vi.advanceTimersByTime(2999 * 1000);
    expect(getCachedSignedUrl("chat/photo.jpg")).not.toBeNull();

    vi.advanceTimersByTime(2 * 1000);
    expect(getCachedSignedUrl("chat/photo.jpg")).toBeNull();
  });

  it("drops an expired entry on read", () => {
    rememberSignedUrl("chat/photo.jpg", "https://storage/photo?token=1", 1000);
    vi.advanceTimersByTime(401 * 1000);

    expect(getCachedSignedUrl("chat/photo.jpg")).toBeNull();
    // Повторное чтение уже удалённой записи тоже не должно ничего вернуть.
    expect(getCachedSignedUrl("chat/photo.jpg")).toBeNull();
  });

  it("does not cache a ttl shorter than the reserve", () => {
    rememberSignedUrl("chat/photo.jpg", "https://storage/photo?token=1", 600);
    expect(getCachedSignedUrl("chat/photo.jpg")).toBeNull();
  });

  it("keeps different keys independent", () => {
    rememberSignedUrl("chat/a.jpg", "https://storage/a?token=1", 3600);
    rememberSignedUrl("chat/b.jpg", "https://storage/b?token=2", 3600);

    expect(getCachedSignedUrl("chat/a.jpg")).toBe("https://storage/a?token=1");
    expect(getCachedSignedUrl("chat/b.jpg")).toBe("https://storage/b?token=2");
  });

  it("distinguishes a document url by file name", () => {
    // Документ подписывается с download=<имя>, поэтому имя — часть ключа.
    rememberSignedUrl("chat/doc.pdf|акт.pdf", "https://storage/doc?token=1", 3600);
    rememberSignedUrl("chat/doc.pdf|смета.pdf", "https://storage/doc?token=2", 3600);

    expect(getCachedSignedUrl("chat/doc.pdf|акт.pdf")).toBe("https://storage/doc?token=1");
    expect(getCachedSignedUrl("chat/doc.pdf|смета.pdf")).toBe("https://storage/doc?token=2");
    expect(getCachedSignedUrl("chat/doc.pdf")).toBeNull();
  });

  it("clears everything", () => {
    rememberSignedUrl("chat/a.jpg", "https://storage/a?token=1", 3600);
    rememberSignedUrl("chat/b.jpg", "https://storage/b?token=2", 3600);

    clearSignedUrlCache();

    expect(getCachedSignedUrl("chat/a.jpg")).toBeNull();
    expect(getCachedSignedUrl("chat/b.jpg")).toBeNull();
  });

  it("resets instead of growing past the limit", () => {
    for (let index = 0; index < 500; index += 1) {
      rememberSignedUrl(`chat/${index}.jpg`, `https://storage/${index}?token=1`, 3600);
    }
    expect(getCachedSignedUrl("chat/0.jpg")).not.toBeNull();

    // 501-я запись очищает кэш целиком — в нём остаётся только новый ключ.
    rememberSignedUrl("chat/new.jpg", "https://storage/new?token=1", 3600);

    expect(getCachedSignedUrl("chat/0.jpg")).toBeNull();
    expect(getCachedSignedUrl("chat/new.jpg")).toBe("https://storage/new?token=1");
  });
});
