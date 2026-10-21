import { describe, expect, it } from "vitest";

import {
  DIRECTION_LOCK_PX,
  PULL_MAX,
  PULL_THRESHOLD,
  canStartPull,
  lockDirection,
  pullDistance,
  shouldRefresh,
  type PullStartContext,
} from "./pull-to-refresh";

const clean: PullStartContext = {
  touchCount: 1,
  scrollY: 0,
  overlayOpen: false,
  inEditable: false,
  scrolledAncestor: false,
  dragActive: false,
  stylus: false,
};

describe("pullDistance", () => {
  it("is zero when the finger has not moved down", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
  });

  it("follows the finger with resistance (less than the raw distance)", () => {
    expect(pullDistance(50)).toBeGreaterThan(0);
    expect(pullDistance(50)).toBeLessThan(50);
  });

  it("grows monotonically but never exceeds the maximum", () => {
    let previous = 0;
    for (let raw = 10; raw <= 2000; raw += 10) {
      const visual = pullDistance(raw);
      expect(visual).toBeGreaterThanOrEqual(previous);
      expect(visual).toBeLessThanOrEqual(PULL_MAX);
      previous = visual;
    }
  });

  it("reaches the refresh threshold within a comfortable thumb drag", () => {
    expect(pullDistance(100)).toBeLessThan(PULL_THRESHOLD);
    expect(pullDistance(200)).toBeGreaterThan(PULL_THRESHOLD);
  });
});

describe("shouldRefresh", () => {
  it("refreshes only at or beyond the threshold", () => {
    expect(shouldRefresh(PULL_THRESHOLD - 1)).toBe(false);
    expect(shouldRefresh(PULL_THRESHOLD)).toBe(true);
    expect(shouldRefresh(PULL_MAX)).toBe(true);
  });
});

describe("lockDirection", () => {
  it("waits until the finger has moved far enough", () => {
    expect(lockDirection(2, DIRECTION_LOCK_PX - 1)).toBe("pending");
    expect(lockDirection(0, 0)).toBe("pending");
  });

  it("locks a mostly vertical downward move as a pull", () => {
    expect(lockDirection(3, DIRECTION_LOCK_PX)).toBe("pull");
    expect(lockDirection(-4, 25)).toBe("pull");
  });

  it("ignores horizontal moves (scrolling tables, the board)", () => {
    expect(lockDirection(DIRECTION_LOCK_PX, 2)).toBe("ignore");
    expect(lockDirection(-30, 12)).toBe("ignore");
  });

  it("ignores a diagonal move that is not clearly vertical", () => {
    expect(lockDirection(15, 15)).toBe("ignore");
  });

  it("ignores an upward move (normal scrolling)", () => {
    expect(lockDirection(1, -DIRECTION_LOCK_PX)).toBe("ignore");
  });
});

describe("canStartPull", () => {
  it("allows a single plain touch at the top of the page", () => {
    expect(canStartPull(clean)).toBe(true);
  });

  it("rejects multi-touch and a stylus", () => {
    expect(canStartPull({ ...clean, touchCount: 2 })).toBe(false);
    expect(canStartPull({ ...clean, touchCount: 0 })).toBe(false);
    expect(canStartPull({ ...clean, stylus: true })).toBe(false);
  });

  it("rejects when the page is scrolled down", () => {
    expect(canStartPull({ ...clean, scrollY: 1 })).toBe(false);
  });

  it("rejects when a dialog, menu or scroll lock is open", () => {
    expect(canStartPull({ ...clean, overlayOpen: true })).toBe(false);
  });

  it("rejects a touch inside a form field", () => {
    expect(canStartPull({ ...clean, inEditable: true })).toBe(false);
  });

  it("rejects a touch inside a scrolled inner scroll area", () => {
    expect(canStartPull({ ...clean, scrolledAncestor: true })).toBe(false);
  });

  it("rejects while a drag-and-drop is active", () => {
    expect(canStartPull({ ...clean, dragActive: true })).toBe(false);
  });
});
