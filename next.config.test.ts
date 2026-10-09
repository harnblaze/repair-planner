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
});
