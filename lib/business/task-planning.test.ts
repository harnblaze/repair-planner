import { describe, expect, it } from "vitest";

import {
  canCarryOverTask,
  canPlanOnDate,
  describeOccurrence,
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
