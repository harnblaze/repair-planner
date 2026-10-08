import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ATTACHMENT_MESSAGES } from "@/lib/errors";

const state = vi.hoisted(() => ({ client: null as unknown, denied: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/projects/access", () => ({
  NO_EDIT_ACCESS_MESSAGE: "Недостаточно прав для изменения данных проекта.",
  requireProjectEdit: vi.fn(async () => state.denied),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.client) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/attachments/cleanup", () => ({ cleanupAttachmentOrphans: vi.fn(async () => 0) }));
vi.mock("@/lib/supabase/token-client", () => ({
  createTokenClient: vi.fn((token: string) => ({ tokenClient: token })),
}));

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { cleanupAttachmentOrphans } from "@/lib/attachments/cleanup";
import { createClient } from "@/lib/supabase/server";
import { createTokenClient } from "@/lib/supabase/token-client";

import {
  confirmTaskAttachmentAction,
  deleteTaskAttachmentAction,
  startTaskAttachmentUploadAction,
} from "./attachment-actions";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK = "e0000000-0000-0000-0000-00000000000a";
const FILE = "f0000000-0000-4000-8000-000000000001";
const PATH = `${PROJECT}/${TASK}/${FILE}.jpg`;

type Builder = {
  select: Mock;
  eq: Mock;
  insert: Mock;
  delete: Mock;
  maybeSingle: Mock;
  then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
};

function builder(result: unknown): Builder {
  const b = {} as Builder;
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => result);
  b.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

function fakeClient(results: Record<string, unknown[]>) {
  const builders: Record<string, Builder[]> = {};
  const storage = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: "t", path },
      error: null,
    })),
    list: vi.fn(async () => ({ data: [{ name: `${FILE}.jpg`, metadata: { size: 345678 } }], error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  };
  const client = {
    from: vi.fn((table: string) => {
      const b = builder(results[table]?.shift());
      (builders[table] ??= []).push(b);
      return b;
    }),
    storage: { from: vi.fn(() => storage) },
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "access-token" } }, error: null })),
    },
  };
  return { client, builders, storage };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
});

describe("startTaskAttachmentUploadAction", () => {
  it("returns the access error without touching Supabase", async () => {
    state.denied = { ok: false, error: "Недостаточно прав для изменения данных проекта." };
    const result = await startTaskAttachmentUploadAction(PROJECT, TASK);
    expect(result).toEqual({ ok: false, error: "Недостаточно прав для изменения данных проекта." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an unknown task", async () => {
    const { client } = fakeClient({ tasks: [{ data: null, error: null }] });
    state.client = client;
    expect(await startTaskAttachmentUploadAction(PROJECT, TASK)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.taskNotFound,
    });
  });

  it("stops at the per-task limit before issuing an upload URL", async () => {
    const { client, storage } = fakeClient({
      tasks: [{ data: { id: TASK }, error: null }],
      task_attachments: [{ count: 30, error: null }],
    });
    state.client = client;
    expect(await startTaskAttachmentUploadAction(PROJECT, TASK)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.limitReached,
    });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("issues a signed upload URL for a server-chosen path", async () => {
    const { client, storage } = fakeClient({
      tasks: [{ data: { id: TASK }, error: null }],
      task_attachments: [{ count: 2, error: null }],
    });
    state.client = client;
    const result = await startTaskAttachmentUploadAction(PROJECT, TASK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toMatch(new RegExp(`^${PROJECT}/${TASK}/[0-9a-f-]{36}\\.jpg$`));
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(result.path);
    expect(result.signedUrl).toContain(result.path);
  });
});

describe("confirmTaskAttachmentAction", () => {
  it("rejects a path of another task without asking Storage", async () => {
    const { client, storage } = fakeClient({});
    state.client = client;
    const foreign = `${PROJECT}/e0000000-0000-0000-0000-00000000000b/${FILE}.jpg`;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, foreign, 2000, 1500)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.uploadFailed,
    });
    expect(storage.list).not.toHaveBeenCalled();
  });

  it("rejects non-integer or oversize dimensions", async () => {
    const { client } = fakeClient({});
    state.client = client;
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 10.5, 100)).ok).toBe(false);
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 100, 2001)).ok).toBe(false);
  });

  it("does not insert a row when the object is missing in Storage", async () => {
    const { client, storage } = fakeClient({});
    storage.list.mockResolvedValueOnce({ data: [], error: null });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.uploadFailed,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("inserts the row with the size reported by Storage", async () => {
    const { client, builders, storage } = fakeClient({ task_attachments: [{ error: null }] });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(storage.list).toHaveBeenCalledWith(`${PROJECT}/${TASK}`, { search: `${FILE}.jpg`, limit: 1 });
    expect(builders.task_attachments[0].insert).toHaveBeenCalledWith({
      project_id: PROJECT,
      task_id: TASK,
      storage_path: PATH,
      size_bytes: 345678,
      width: 2000,
      height: 1500,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/${PROJECT}/tasks/${TASK}`);
  });

  it("treats a repeated confirm of the same path as success and keeps the file", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ error: { code: "23505", message: "duplicate key" } }],
    });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removes the uploaded file when the row cannot be inserted", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ error: { code: "23503", message: "fk violation" } }],
    });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.uploadFailed,
    });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });
});

describe("upper-case ids in the URL", () => {
  it("issues a lower-case path, which the storage policy accepts", async () => {
    const { client, storage } = fakeClient({
      tasks: [{ data: { id: TASK }, error: null }],
      task_attachments: [{ count: 0, error: null }],
    });
    state.client = client;
    const result = await startTaskAttachmentUploadAction(PROJECT.toUpperCase(), TASK.toUpperCase());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path.startsWith(`${PROJECT}/${TASK}/`)).toBe(true);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(result.path);
  });

  it("confirms by the lower-case folder", async () => {
    const { client, storage } = fakeClient({ task_attachments: [{ error: null }] });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT.toUpperCase(), TASK.toUpperCase(), PATH, 2000, 1500)).toEqual({
      ok: true,
    });
    expect(storage.list).toHaveBeenCalledWith(`${PROJECT}/${TASK}`, { search: `${FILE}.jpg`, limit: 1 });
  });
});

describe("deleteTaskAttachmentAction", () => {
  it("reports a missing photo and does not touch Storage", async () => {
    const { client, storage } = fakeClient({ task_attachments: [{ data: [], error: null }] });
    state.client = client;
    expect(await deleteTaskAttachmentAction(PROJECT, TASK, "id-1")).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.notFound,
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removes the file by the path stored in the deleted row", async () => {
    const { client, builders, storage } = fakeClient({
      task_attachments: [{ data: [{ storage_path: PATH }], error: null }],
    });
    state.client = client;
    expect(await deleteTaskAttachmentAction(PROJECT, TASK, "id-1")).toEqual({ ok: true });
    expect(builders.task_attachments[0].eq).toHaveBeenCalledWith("id", "id-1");
    expect(builders.task_attachments[0].eq).toHaveBeenCalledWith("task_id", TASK);
    expect(builders.task_attachments[0].eq).toHaveBeenCalledWith("project_id", PROJECT);
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("still succeeds when the file removal fails (orphan is only logged)", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ data: [{ storage_path: PATH }], error: null }],
    });
    storage.remove.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    state.client = client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteTaskAttachmentAction(PROJECT, TASK, "id-1")).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("orphan cleanup after upload", () => {
  it("schedules cleanup of the project after a successful confirm", async () => {
    const { client } = fakeClient({ task_attachments: [{ error: null }] });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(1);
    expect(cleanupAttachmentOrphans).not.toHaveBeenCalled();

    const task = (after as Mock).mock.calls[0][0] as () => Promise<unknown>;
    await task();
    // Не клиент на cookies: в after() он не может сохранить обновлённую сессию.
    expect(createTokenClient).toHaveBeenCalledWith("access-token");
    expect(cleanupAttachmentOrphans).toHaveBeenCalledWith({ tokenClient: "access-token" }, PROJECT);
    expect(cleanupAttachmentOrphans).not.toHaveBeenCalledWith(client, PROJECT);
  });

  it("skips cleanup when there is no session token", async () => {
    const { client } = fakeClient({ task_attachments: [{ error: null }] });
    client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(after).not.toHaveBeenCalled();
  });

  it("schedules cleanup on a repeated confirm of the same path", async () => {
    const { client } = fakeClient({
      task_attachments: [{ error: { code: "23505", message: "duplicate key" } }],
    });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("does not schedule cleanup when the confirm fails", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ error: { code: "23503", message: "fk violation" } }],
    });
    state.client = client;
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).ok).toBe(false);

    storage.list.mockResolvedValueOnce({ data: [], error: null });
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).ok).toBe(false);

    expect(after).not.toHaveBeenCalled();
  });
});
