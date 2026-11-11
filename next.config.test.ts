import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config headers", () => {
  it("never lets the browser or a proxy cache the service worker", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const sw = rules.find((r) => r.source === "/sw.js");
    expect(sw?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      ]),
    );
  });

  it("закрывает кликджекинг и сниффинг на всех путях", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === "/:path*");
    const headers = all?.headers ?? [];

    expect(headers).toEqual(
      expect.arrayContaining([
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
    // frame-ancestors важнее X-Frame-Options: современные браузеры смотрят в CSP.
    const csp = headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("не раскрывает стек в заголовках ответа", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
