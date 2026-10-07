import { describe, expect, it } from "vitest";
import { cn, confirmRedirectPath, safeNextPath } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
  });

  it("drops falsy values", () => {
    expect(cn("p-2", false && "hidden", undefined, "text-sm")).toBe("p-2 text-sm");
  });
});

describe("safeNextPath", () => {
  it("keeps paths inside the application", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("/p1/board?week=2026-09-14")).toBe("/p1/board?week=2026-09-14");
  });

  it("falls back to projects for missing or external targets", () => {
    expect(safeNextPath(undefined)).toBe("/projects");
    expect(safeNextPath("")).toBe("/projects");
    expect(safeNextPath("https://evil.example")).toBe("/projects");
    expect(safeNextPath("//evil.example")).toBe("/projects");
    expect(safeNextPath("/\\evil.example")).toBe("/projects");
    expect(safeNextPath(`/${String.fromCharCode(9)}/evil.example`)).toBe("/projects");
  });
});

describe("confirmRedirectPath", () => {
  // Хост, к которому обратился браузер (x-forwarded-host / host).
  const host = "planner.example";

  it("keeps a path inside the application", () => {
    expect(confirmRedirectPath("/reset-password", host, "/profile")).toBe("/reset-password");
  });

  it("turns a same-host URL into a path", () => {
    expect(confirmRedirectPath("https://planner.example/invite/abc", host, "/profile")).toBe("/invite/abc");
    expect(confirmRedirectPath("https://planner.example/p1/board?week=2026-10-12", host, "/profile")).toBe(
      "/p1/board?week=2026-10-12",
    );
  });

  it("ignores the protocol behind a TLS-terminating proxy", () => {
    expect(confirmRedirectPath("http://planner.example/invite/abc", host, "/profile")).toBe("/invite/abc");
  });

  it("compares the port as part of the host", () => {
    expect(confirmRedirectPath("http://127.0.0.1:3000/invite/abc", "127.0.0.1:3000", "/profile")).toBe("/invite/abc");
    expect(confirmRedirectPath("http://127.0.0.1:4000/invite/abc", "127.0.0.1:3000", "/profile")).toBe("/profile");
  });

  it("uses the fallback for a missing value", () => {
    expect(confirmRedirectPath(null, host, "/profile")).toBe("/profile");
    expect(confirmRedirectPath("", host, "/profile")).toBe("/profile");
  });

  it("never redirects to another site", () => {
    expect(confirmRedirectPath("https://evil.example/invite/abc", host, "/profile")).toBe("/profile");
    expect(confirmRedirectPath("https://planner.example.evil.example/", host, "/profile")).toBe("/profile");
    expect(confirmRedirectPath("//evil.example", host, "/profile")).toBe("/profile");
    expect(confirmRedirectPath("/\\evil.example", host, "/profile")).toBe("/profile");
    expect(confirmRedirectPath("javascript:alert(1)", host, "/profile")).toBe("/profile");
  });

  it("uses the fallback for a malformed URL", () => {
    expect(confirmRedirectPath("http://", host, "/profile")).toBe("/profile");
  });
});
