import { describe, expect, it } from "vitest";

import { confirmBranch, isEmailOtpType, unwrapConfirmNext } from "@/lib/business/confirm";
import { safeNextPath } from "@/lib/utils";

const resolve = (value: string | null) => safeNextPath(value, "/profile");

describe("confirmBranch", () => {
  it("treats an explicit error as expired", () => {
    expect(confirmBranch({ error: "access_denied" })).toBe("expired");
    expect(confirmBranch({ errorDescription: "Email link is invalid or has expired" })).toBe("expired");
    // Ошибка важнее токенов: показывать «проверяем» уже нельзя.
    expect(confirmBranch({ error: "access_denied", tokenHash: "abc", type: "recovery" })).toBe("expired");
  });

  it("verifies a token hash from our templates", () => {
    expect(confirmBranch({ tokenHash: "pkce_abc", type: "email" })).toBe("otp");
    expect(confirmBranch({ tokenHash: "pkce_abc", type: "signup" })).toBe("otp");
    expect(confirmBranch({ tokenHash: "pkce_abc", type: "recovery" })).toBe("otp");
  });

  it("rejects a token hash without a usable type", () => {
    expect(confirmBranch({ tokenHash: "pkce_abc" })).toBe("expired");
    expect(confirmBranch({ tokenHash: "pkce_abc", type: "unknown" })).toBe("expired");
    expect(confirmBranch({ tokenHash: "   ", type: "recovery" })).toBe("expired");
  });

  it("rejects a type without a token hash", () => {
    expect(confirmBranch({ type: "recovery" })).toBe("expired");
  });

  it("exchanges a PKCE code", () => {
    expect(confirmBranch({ code: "abc123" })).toBe("code");
  });

  it("treats an empty code as expired, not as a missing one", () => {
    expect(confirmBranch({ code: "" })).toBe("expired");
    expect(confirmBranch({ code: "   " })).toBe("expired");
  });

  it("waits for tokens in the fragment when nothing came in the query", () => {
    expect(confirmBranch({})).toBe("hash");
    expect(confirmBranch({ code: null, tokenHash: null, type: null })).toBe("hash");
  });

  it("knows the token types verifyOtp accepts", () => {
    expect(isEmailOtpType("email")).toBe(true);
    expect(isEmailOtpType("recovery")).toBe(true);
    expect(isEmailOtpType("nope")).toBe(false);
  });
});

describe("unwrapConfirmNext", () => {
  it("keeps a plain path", () => {
    expect(unwrapConfirmNext("/reset-password", resolve)).toBe("/reset-password");
    expect(unwrapConfirmNext("/invite/abc", resolve)).toBe("/invite/abc");
  });

  it("unwraps the destination our email template passes as next", () => {
    expect(unwrapConfirmNext("/auth/confirm?next=%2Freset-password", resolve)).toBe("/reset-password");
    expect(unwrapConfirmNext("/auth/confirm?next=/invite/abc", resolve)).toBe("/invite/abc");
  });

  it("unwraps a full URL of the same site", () => {
    expect(
      unwrapConfirmNext("/auth/confirm?next=https%3A%2F%2Fplanner.example%2Fprojects", resolve),
    ).toBe("/profile");
  });

  it("stops instead of looping when the link points to itself", () => {
    // Ссылка сама на себя: разворачивать нечего, страница остаётся на месте и
    // покажет «ссылка недействительна» после ожидания сессии.
    expect(unwrapConfirmNext("/auth/confirm?next=/auth/confirm", resolve)).toBe("/auth/confirm");
  });

  it("does not follow an external destination", () => {
    expect(unwrapConfirmNext("/auth/confirm?next=https%3A%2F%2Fevil.example%2F", resolve)).toBe("/profile");
    expect(unwrapConfirmNext("/auth/confirm?next=//evil.example", resolve)).toBe("/profile");
  });

  it("leaves an unrelated path alone", () => {
    expect(unwrapConfirmNext("/projects", resolve)).toBe("/projects");
  });
});
