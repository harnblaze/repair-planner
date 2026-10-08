import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ client: true })) }));

import { createClient } from "@supabase/supabase-js";

import { createTokenClient } from "./token-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

describe("createTokenClient", () => {
  it("authenticates every request with the given access token", async () => {
    expect(createTokenClient("access-token")).toEqual({ client: true });
    expect(createClient).toHaveBeenCalledTimes(1);

    const [url, key, options] = (createClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://project.supabase.test");
    expect(key).toBe("anon-key");
    await expect(options.accessToken()).resolves.toBe("access-token");
  });
});
