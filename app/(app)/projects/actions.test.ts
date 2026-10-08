import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PROJECT_MESSAGES } from "@/lib/errors";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.client) }));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { archiveProjectAction, deleteProjectAction, restoreProjectAction } from "./actions";

const PROJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NAME = "Старый цех";
const path = (n: number) => `${PROJECT}/e0000000-0000-0000-0000-00000000000a/f0000000-0000-4000-8000-00000000000${n}.jpg`;

type Builder = {
  select: Mock;
  eq: Mock;
  is: Mock;
  not: Mock;
  update: Mock;
  delete: Mock;
  maybeSingle: Mock;
  then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
};

function builder(result: unknown): Builder {
  const b = {} as Builder;
  for (const method of ["select", "eq", "is", "not", "update", "delete"] as const) b[method] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => result);
  b.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

/** projects — результаты по очереди вызовов from("projects"); rpc — по очереди вызовов RPC. */
function fakeClient(projects: unknown[], rpc: unknown[] = [], removes: unknown[] = []) {
  const builders: Builder[] = [];
  const remove = vi.fn(async () => removes.shift() ?? { data: [], error: null });
  const client = {
    from: vi.fn(() => {
      const b = builder(projects.shift());
      builders.push(b);
      return b;
    }),
    rpc: vi.fn(async () => rpc.shift() ?? { data: [], error: null }),
    storage: { from: vi.fn(() => ({ remove })) },
  };
  return { client, builders, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("archiveProjectAction", () => {
  it("archives an active project and goes to the project list", async () => {
    const { client, builders } = fakeClient([{ data: [{ id: PROJECT }], error: null }]);
    state.client = client;
    await archiveProjectAction(PROJECT);
    expect(builders[0].update).toHaveBeenCalledWith({ archived_at: expect.any(String) });
    expect(builders[0].eq).toHaveBeenCalledWith("id", PROJECT);
    expect(builders[0].is).toHaveBeenCalledWith("archived_at", null);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(redirect).toHaveBeenCalledWith("/projects");
  });

  it("reports missing rights when no row was updated", async () => {
    state.client = fakeClient([{ data: [], error: null }]).client;
    expect(await archiveProjectAction(PROJECT)).toEqual({ ok: false, error: PROJECT_MESSAGES.ownerOnly });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("hides database errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.client = fakeClient([{ data: null, error: { message: "boom" } }]).client;
    expect(await archiveProjectAction(PROJECT)).toEqual({ ok: false, error: PROJECT_MESSAGES.archiveFailed });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a malformed id without touching Supabase", async () => {
    expect(await archiveProjectAction("not-a-uuid")).toEqual({ ok: false, error: PROJECT_MESSAGES.notFound });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("restoreProjectAction", () => {
  it("restores an archived project", async () => {
    const { client, builders } = fakeClient([{ data: [{ id: PROJECT }], error: null }]);
    state.client = client;
    expect(await restoreProjectAction(PROJECT)).toEqual({ ok: true });
    expect(builders[0].update).toHaveBeenCalledWith({ archived_at: null });
    expect(builders[0].not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("reports missing rights when no row was updated", async () => {
    state.client = fakeClient([{ data: [], error: null }]).client;
    expect(await restoreProjectAction(PROJECT)).toEqual({ ok: false, error: PROJECT_MESSAGES.ownerOnly });
  });
});

describe("deleteProjectAction", () => {
  const archived = { data: { name: NAME, archived_at: "2026-10-08T10:00:00Z" }, error: null };
  const deleted = { data: [{ id: PROJECT }], error: null };

  it("removes files in batches, then deletes the project", async () => {
    const { client, builders, remove } = fakeClient(
      [archived, deleted],
      [
        { data: [path(1), path(2)], error: null },
        { data: [path(3)], error: null },
        { data: [], error: null },
      ],
      [
        { data: [{ name: "1" }, { name: "2" }], error: null },
        { data: [{ name: "3" }], error: null },
      ],
    );
    state.client = client;
    expect(await deleteProjectAction(PROJECT, `  ${NAME} `)).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledWith("project_attachment_paths", { p_project_id: PROJECT });
    expect(remove).toHaveBeenNthCalledWith(1, [path(1), path(2)]);
    expect(remove).toHaveBeenNthCalledWith(2, [path(3)]);
    expect(builders[1].delete).toHaveBeenCalled();
    expect(builders[1].eq).toHaveBeenCalledWith("id", PROJECT);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("refuses when the name does not match", async () => {
    const { client, remove } = fakeClient([archived]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, "старый цех")).toEqual({
      ok: false,
      error: PROJECT_MESSAGES.nameMismatch,
    });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("refuses an active project", async () => {
    const { client } = fakeClient([{ data: { name: NAME, archived_at: null }, error: null }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.notArchived });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses a project the user cannot see", async () => {
    const { client } = fakeClient([{ data: null, error: null }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.notArchived });
  });

  it("keeps the project when Storage fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(
      [archived],
      [{ data: [path(1)], error: null }],
      [{ data: null, error: { message: "boom" } }],
    );
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.deleteFailed });
    expect(client.from).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("keeps the project when Storage removed only part of the batch", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, remove } = fakeClient(
      [archived],
      [{ data: [path(1), path(2)], error: null }],
      [{ data: [{ name: "1" }], error: null }],
    );
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.deleteFailed });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("keeps the project when the path lookup fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, remove } = fakeClient([archived], [{ data: null, error: { message: "boom" } }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.deleteFailed });
    expect(remove).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("reports missing rights when the delete matched no row", async () => {
    const { client } = fakeClient([archived, { data: [], error: null }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.ownerOnly });
  });
});
