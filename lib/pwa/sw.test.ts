import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

// public/sw.js — обычный скрипт без сборки; запускаем его в песочнице с
// поддельными self/caches/fetch и вызываем обработчики событий напрямую.
const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

type Handler = (event: Record<string, unknown>) => void;

function loadWorker({ fetchImpl, cacheNames = [] as string[] }: { fetchImpl?: () => Promise<Response>; cacheNames?: string[] } = {}) {
  const handlers: Record<string, Handler> = {};
  const offlinePage = new Response("offline");
  const cache = { add: vi.fn(async () => undefined) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => cacheNames),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => offlinePage),
  };
  const self = {
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const fetch = vi.fn(fetchImpl ?? (async () => new Response("page")));
  // Настоящий Request не принимает относительный URL вне браузера.
  const FakeRequest = class {
    constructor(
      public url: string,
      public init?: RequestInit,
    ) {}
  };
  runInNewContext(SOURCE, { self, caches, fetch, Request: FakeRequest, Response });
  return { handlers, cache, caches, self, fetch, offlinePage };
}

async function dispatch(handler: Handler, extra: Record<string, unknown> = {}) {
  let waited: Promise<unknown> | undefined;
  let responded: Promise<Response> | undefined;
  handler({
    ...extra,
    waitUntil: (p: Promise<unknown>) => (waited = p),
    respondWith: (p: Promise<Response>) => (responded = p),
  });
  await waited;
  return responded;
}

describe("service worker", () => {
  it("caches only the offline page on install and activates at once", async () => {
    const w = loadWorker();
    await dispatch(w.handlers.install);
    expect(w.cache.add).toHaveBeenCalledTimes(1);
    expect(w.cache.add).toHaveBeenCalledWith(expect.objectContaining({ url: "/offline.html" }));
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  it("removes caches of older versions on activate", async () => {
    const w = loadWorker({ cacheNames: ["offline-v0", "offline-v1"] });
    await dispatch(w.handlers.activate);
    const deleted = w.caches.delete.mock.calls.map((c) => (c as unknown[])[0]);
    expect(deleted).toContain("offline-v0");
    expect(deleted).toHaveLength(1);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it("leaves non-navigation requests (data, scripts, images) to the browser", async () => {
    const w = loadWorker();
    const responded = await dispatch(w.handlers.fetch, { request: { mode: "cors", url: "https://x.test/rest" } });
    expect(responded).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("serves pages from the network when it is available", async () => {
    const w = loadWorker();
    const responded = await dispatch(w.handlers.fetch, { request: { mode: "navigate", url: "https://x.test/projects" } });
    expect(await responded!.text()).toBe("page");
  });

  it("shows the offline page when a page cannot be loaded", async () => {
    const w = loadWorker({ fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")) });
    const responded = await dispatch(w.handlers.fetch, { request: { mode: "navigate", url: "https://x.test/projects" } });
    expect(responded).toBe(w.offlinePage);
  });
});
