import { afterEach, describe, expect, it, vi } from "vitest";

import { compressImage } from "./compress-image";

// Окружение vitest — node: canvas и createImageBitmap подменяются, проверяется
// только порядок рисования. Настоящее сжатие проверяется в браузере.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubCanvas(calls: string[]) {
  const context = {
    imageSmoothingQuality: "low",
    fillStyle: "",
    fillRect: vi.fn(() => calls.push(`fillRect:${context.fillStyle}`)),
    drawImage: vi.fn(() => calls.push("drawImage")),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(["jpeg"], { type: "image/jpeg" })),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
  );
}

describe("compressImage", () => {
  it("paints a white background first, so transparent areas do not turn black in JPEG", async () => {
    const calls: string[] = [];
    stubCanvas(calls);

    const result = await compressImage(new File(["png"], "screenshot.png", { type: "image/png" }));

    expect(calls).toEqual(["fillRect:#ffffff", "drawImage"]);
    expect(result).toMatchObject({ width: 2000, height: 1500 });
  });
});
