import { describe, expect, it } from "vitest";

import {
  canCarryOverFromBoard,
  canCarryOverTask,
  canCompleteFromBoard,
  canUndoCarryOverFromBoard,
  canPlanOnDate,
  describeOccurrence,
  isUndoableCarryOver,
  keepsDayOnReturnToBacklog,
  lastWorkDate,
} from "./task-planning";

describe("canCarryOverTask", () => {
  it("разрешает перенос незавершённой задачи", () => {
    expect(canCarryOverTask("new")).toBe(true);
    expect(canCarryOverTask("planned")).toBe(true);
    expect(canCarryOverTask("in_progress")).toBe(true);
    expect(canCarryOverTask("paused")).toBe(true);
  });

  it("запрещает перенос завершённой или отменённой задачи", () => {
    expect(canCarryOverTask("completed")).toBe(false);
    expect(canCarryOverTask("cancelled")).toBe(false);
  });
});

describe("canCarryOverFromBoard", () => {
  const live = { status: "in_progress" as const, isHistory: false };

  it("разрешает перенос с карточки последнего дня незавершённой задачи", () => {
    expect(canCarryOverFromBoard(live, true)).toBe(true);
  });

  it("не показывает перенос на карточке дня из истории", () => {
    expect(canCarryOverFromBoard({ ...live, isHistory: true }, true)).toBe(false);
  });

  it("не показывает перенос завершённой или отменённой задачи", () => {
    expect(canCarryOverFromBoard({ ...live, status: "completed" }, true)).toBe(false);
    expect(canCarryOverFromBoard({ ...live, status: "cancelled" }, true)).toBe(false);
  });

  it("не показывает перенос без права редактирования", () => {
    expect(canCarryOverFromBoard(live, false)).toBe(false);
  });
});

describe("canCompleteFromBoard", () => {
  const live = { status: "planned" as const, isHistory: false };

  it("разрешает завершение с карточки последнего дня открытой задачи", () => {
    expect(canCompleteFromBoard(live, true)).toBe(true);
    expect(canCompleteFromBoard({ ...live, status: "paused" }, true)).toBe(true);
  });

  it("не показывает завершение на дне из истории, у закрытой задачи и без права редактирования", () => {
    expect(canCompleteFromBoard({ ...live, isHistory: true }, true)).toBe(false);
    expect(canCompleteFromBoard({ ...live, status: "completed" }, true)).toBe(false);
    expect(canCompleteFromBoard({ ...live, status: "cancelled" }, true)).toBe(false);
    expect(canCompleteFromBoard(live, false)).toBe(false);
  });
});

describe("isUndoableCarryOver", () => {
  const carried = [
    { workDate: "2026-10-07", postponed: false },
    { workDate: "2026-10-08", postponed: false },
  ];

  it("разрешает отмену в сам день переноса и раньше него", () => {
    expect(isUndoableCarryOver("2026-10-08", "2026-10-08", carried, "2026-10-08")).toBe(true);
    expect(isUndoableCarryOver("2026-10-08", "2026-10-08", carried, "2026-10-07")).toBe(true);
  });

  it("запрещает отмену, когда перенесённый день прошёл", () => {
    expect(isUndoableCarryOver("2026-10-08", "2026-10-08", carried, "2026-10-09")).toBe(false);
  });

  it("не предлагает отмену на дне из истории", () => {
    expect(isUndoableCarryOver("2026-10-07", "2026-10-08", carried, "2026-10-07")).toBe(false);
  });

  it("не считает переносом единственный день и день после отложенного", () => {
    expect(isUndoableCarryOver("2026-10-08", "2026-10-08", [carried[1]], "2026-10-08")).toBe(false);
    const afterPostponed = [{ workDate: "2026-10-05", postponed: true }, carried[1]];
    expect(isUndoableCarryOver("2026-10-08", "2026-10-08", afterPostponed, "2026-10-08")).toBe(false);
  });
});

describe("canUndoCarryOverFromBoard", () => {
  const live = { status: "in_progress" as const, undoableCarryOver: true };

  it("показывает «↩», когда перенос можно отменить", () => {
    expect(canUndoCarryOverFromBoard(live, true)).toBe(true);
  });

  it("не показывает «↩» без отменяемого переноса, у закрытой задачи и без права редактирования", () => {
    expect(canUndoCarryOverFromBoard({ ...live, undoableCarryOver: false }, true)).toBe(false);
    expect(canUndoCarryOverFromBoard({ ...live, isHistory: true }, true)).toBe(false);
    expect(canUndoCarryOverFromBoard({ ...live, status: "completed" }, true)).toBe(false);
    expect(canUndoCarryOverFromBoard(live, false)).toBe(false);
  });
});

describe("describeOccurrence", () => {
  const single = [{ workDate: "2026-09-15", postponed: false }];
  const carried = [
    { workDate: "2026-09-14", postponed: false },
    { workDate: "2026-09-15", postponed: false },
  ];

  it("текущий день однодневной задачи можно перетащить на другой день", () => {
    expect(describeOccurrence("2026-09-15", "2026-09-15", single)).toEqual({
      isHistory: false,
      note: null,
      canChangeDay: true,
    });
  });

  it("текущий день перенесённой задачи — не история, но день не меняется", () => {
    expect(describeOccurrence("2026-09-15", "2026-09-15", carried)).toEqual({
      isHistory: false,
      note: null,
      canChangeDay: false,
    });
  });

  it("день, после которого задачу перенесли, — история с реальной датой продолжения", () => {
    expect(describeOccurrence("2026-09-14", "2026-09-15", carried)).toEqual({
      isHistory: true,
      note: "Перенесена на 15 сентября",
      canChangeDay: false,
    });
  });

  it("отложенная задача без продолжения", () => {
    const days = [
      { workDate: "2026-09-14", postponed: false },
      { workDate: "2026-09-15", postponed: true },
    ];
    expect(describeOccurrence("2026-09-15", null, days).note).toBe("Отложена");
    expect(describeOccurrence("2026-09-14", null, days).note).toBe("Перенесена на 15 сентября");
  });

  it("отложенная и позже продолженная задача: дата продолжения не обязана быть следующим рабочим днём", () => {
    const days = [
      { workDate: "2026-09-15", postponed: true },
      { workDate: "2026-09-25", postponed: false },
    ];
    expect(describeOccurrence("2026-09-15", "2026-09-25", days)).toEqual({
      isHistory: true,
      note: "Отложена, продолжена 25 сентября",
      canChangeDay: false,
    });
  });
});

describe("keepsDayOnReturnToBacklog", () => {
  const today = "2026-09-15";

  it("незапущенная задача: все дни — только план", () => {
    expect(keepsDayOnReturnToBacklog("new", "2026-09-14", today)).toBe(false);
    expect(keepsDayOnReturnToBacklog("planned", today, today)).toBe(false);
  });

  it("задача в работе или приостановлена: прошедшие дни и сегодня остаются", () => {
    expect(keepsDayOnReturnToBacklog("in_progress", "2026-09-14", today)).toBe(true);
    expect(keepsDayOnReturnToBacklog("in_progress", today, today)).toBe(true);
    expect(keepsDayOnReturnToBacklog("paused", today, today)).toBe(true);
  });

  it("будущие дни удаляются всегда", () => {
    expect(keepsDayOnReturnToBacklog("in_progress", "2026-09-16", today)).toBe(false);
  });
});

describe("canPlanOnDate / lastWorkDate", () => {
  it("задачу без истории можно запланировать на любой день", () => {
    expect(canPlanOnDate(null, "2020-01-06")).toBe(true);
  });

  it("отложенную задачу — не раньше последнего дня истории", () => {
    const last = lastWorkDate([
      { workDate: "2026-09-15", postponed: true },
      { workDate: "2026-09-14", postponed: false },
    ]);
    expect(last).toBe("2026-09-15");
    expect(canPlanOnDate(last, "2026-09-14")).toBe(false);
    expect(canPlanOnDate(last, "2026-09-15")).toBe(true);
    expect(canPlanOnDate(last, "2026-09-16")).toBe(true);
  });

  it("lastWorkDate пустого расписания — null", () => {
    expect(lastWorkDate([])).toBeNull();
  });
});
