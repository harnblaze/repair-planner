import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "./manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("names the app «Планировщик» and keeps the label short enough for the home screen", () => {
    expect(m.name).toBe("Планировщик");
    expect(m.short_name).toBe("Планировщик");
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("opens standalone from the root, in Russian", () => {
    expect(m).toMatchObject({ start_url: "/", scope: "/", display: "standalone", lang: "ru" });
  });

  it("has the icons install prompts require, including a maskable one", () => {
    const sizes = m.icons!.map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  });

  it("points only at icon files that exist in public/", () => {
    for (const icon of m.icons!) {
      expect(existsSync(join(process.cwd(), "public", icon.src)), icon.src).toBe(true);
    }
  });
});
