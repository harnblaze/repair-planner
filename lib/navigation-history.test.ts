import { describe, expect, it } from "vitest";

import { INITIAL_NAVIGATION, recordNavigation } from "./navigation-history";

describe("recordNavigation", () => {
  it("первая страница вкладки — переходов внутри приложения ещё не было", () => {
    const state = recordNavigation(INITIAL_NAVIGATION, "/p/tasks/t");

    expect(state.hasInAppHistory).toBe(false);
  });

  it("повторная запись той же страницы (двойной эффект StrictMode) — не переход", () => {
    const state = recordNavigation(recordNavigation(INITIAL_NAVIGATION, "/p/tasks/t"), "/p/tasks/t");

    expect(state.hasInAppHistory).toBe(false);
  });

  it("переход на другую страницу — можно вернуться назад внутри приложения", () => {
    const state = recordNavigation(recordNavigation(INITIAL_NAVIGATION, "/p/board"), "/p/tasks/t");

    expect(state.hasInAppHistory).toBe(true);
  });

  it("после перехода признак сохраняется на следующих страницах", () => {
    let state = recordNavigation(INITIAL_NAVIGATION, "/p/board");
    state = recordNavigation(state, "/p/tasks/t");
    state = recordNavigation(state, "/p/tasks/t");

    expect(state.hasInAppHistory).toBe(true);
  });
});
