import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const state = vi.hoisted(() => ({ client: null as unknown, denied: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/projects/access", () => ({
  requireProjectEdit: vi.fn(async () => state.denied),
}));
vi.mock("@/lib/projects/calendar", () => ({ getWorkCalendar: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.client) }));

import { revalidatePath } from "next/cache";

import { assignTaskExecutorAction, unassignTaskExecutorAction } from "./actions";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK = "e0000000-0000-0000-0000-00000000000a";
const EXECUTOR = "c0000000-0000-0000-0000-00000000000c";

type Builder = {
  upsert: Mock;
  delete: Mock;
  eq: Mock;
  then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
};

function fakeClient(result: unknown) {
  const b = {} as Builder;
  b.upsert = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  const client = { from: vi.fn(() => b) };
  return { client, builder: b };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
  state.client = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assignTaskExecutorAction", () => {
  it("returns the access error without touching the database", async () => {
    state.denied = { ok: false, error: "Недостаточно прав для изменения данных проекта." };
    const { client } = fakeClient({ error: null });
    state.client = client;

    expect(await assignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual(state.denied);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects ids that are not uuids", async () => {
    const { client } = fakeClient({ error: null });
    state.client = client;

    const result = await assignTaskExecutorAction(PROJECT, TASK, "not-an-id");
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("adds one row, ignores an existing assignment and refreshes the board", async () => {
    const { client, builder } = fakeClient({ error: null });
    state.client = client;

    expect(await assignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual({ ok: true });
    expect(client.from).toHaveBeenCalledWith("task_executors");
    expect(builder.upsert).toHaveBeenCalledWith(
      { task_id: TASK, executor_id: EXECUTOR, project_id: PROJECT },
      { onConflict: "task_id,executor_id", ignoreDuplicates: true },
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/${PROJECT}/board`);
  });

  it("explains a task or executor from another project", async () => {
    // Составные FK (task_id, project_id) и (executor_id, project_id) — 0004.
    const { client } = fakeClient({ error: { code: "23503", message: "fk" } });
    state.client = client;

    expect(await assignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual({
      ok: false,
      error: "Заявка или исполнитель не найдены. Обновите страницу.",
    });
  });

  it("hides technical details of other errors", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "row-level security" } });
    state.client = client;

    expect(await assignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual({
      ok: false,
      error: "Не удалось изменить исполнителей. Попробуйте ещё раз.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("unassignTaskExecutorAction", () => {
  it("returns the access error without touching the database", async () => {
    state.denied = { ok: false, error: "Недостаточно прав для изменения данных проекта." };
    const { client } = fakeClient({ error: null });
    state.client = client;

    expect(await unassignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual(state.denied);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects ids that are not uuids", async () => {
    const { client } = fakeClient({ error: null });
    state.client = client;

    const result = await unassignTaskExecutorAction(PROJECT, "x", EXECUTOR);
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("deletes only this assignment within the project", async () => {
    const { client, builder } = fakeClient({ error: null });
    state.client = client;

    expect(await unassignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual({ ok: true });
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("project_id", PROJECT);
    expect(builder.eq).toHaveBeenCalledWith("task_id", TASK);
    expect(builder.eq).toHaveBeenCalledWith("executor_id", EXECUTOR);
    expect(revalidatePath).toHaveBeenCalledWith(`/${PROJECT}/board`);
  });

  it("hides technical details of errors", async () => {
    const { client } = fakeClient({ error: { code: "XX000", message: "boom" } });
    state.client = client;

    expect(await unassignTaskExecutorAction(PROJECT, TASK, EXECUTOR)).toEqual({
      ok: false,
      error: "Не удалось изменить исполнителей. Попробуйте ещё раз.",
    });
  });
});
