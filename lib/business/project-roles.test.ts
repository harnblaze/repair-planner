import { describe, expect, it } from "vitest";

import {
  canEditProject,
  canManageProject,
  isInvitationExpired,
  projectRoleLabel,
} from "@/lib/business/project-roles";

describe("canEditProject", () => {
  it("allows owner and member", () => {
    expect(canEditProject("owner")).toBe(true);
    expect(canEditProject("member")).toBe(true);
  });

  it("denies viewer and users without access", () => {
    expect(canEditProject("viewer")).toBe(false);
    expect(canEditProject(null)).toBe(false);
    expect(canEditProject(undefined)).toBe(false);
  });
});

describe("canManageProject", () => {
  it("allows only the owner", () => {
    expect(canManageProject("owner")).toBe(true);
    expect(canManageProject("member")).toBe(false);
    expect(canManageProject("viewer")).toBe(false);
    expect(canManageProject(null)).toBe(false);
  });
});

describe("projectRoleLabel", () => {
  it("returns Russian labels for stable role values", () => {
    expect(projectRoleLabel("owner")).toBe("Владелец");
    expect(projectRoleLabel("member")).toBe("Редактор");
    expect(projectRoleLabel("viewer")).toBe("Только просмотр");
  });
});

describe("isInvitationExpired", () => {
  const now = new Date("2026-09-13T12:00:00Z");

  it("treats the expiry moment itself as expired", () => {
    expect(isInvitationExpired("2026-09-13T12:00:00+00:00", now)).toBe(true);
    expect(isInvitationExpired("2026-09-13T11:59:59Z", now)).toBe(true);
  });

  it("keeps a future expiry valid regardless of the offset format", () => {
    expect(isInvitationExpired("2026-09-13T15:00:01+03:00", now)).toBe(false);
  });
});
