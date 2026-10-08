import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupAttachmentOrphans } from "./cleanup";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const P1 = `${PROJECT}/e0000000-0000-0000-0000-00000000000a/f0000000-0000-4000-8000-000000000001.jpg`;
const P2 = `${PROJECT}/e0000000-0000-0000-0000-00000000000a/f0000000-0000-4000-8000-000000000002.jpg`;

function fakeClient(rpcResult: unknown, removeResult: unknown = { data: [], error: null }) {
  const remove = vi.fn(async () => removeResult);
  const from = vi.fn(() => ({ remove }));
  const rpc = vi.fn(async () => rpcResult);
  return { client: { rpc, storage: { from } } as never, rpc, from, remove };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cleanupAttachmentOrphans", () => {
  it("removes all found orphans with one Storage call", async () => {
    const { client, rpc, from, remove } = fakeClient({ data: [P1, P2], error: null });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(2);
    expect(rpc).toHaveBeenCalledWith("task_attachment_orphans", { p_project_id: PROJECT });
    expect(from).toHaveBeenCalledWith("task-attachments");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([P1, P2]);
  });

  it("does not call Storage when there are no orphans", async () => {
    const { client, remove } = fakeClient({ data: [], error: null });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it("logs an RPC error and removes nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, remove } = fakeClient({ data: null, error: { message: "boom" } });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(0);
    expect(remove).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("logs a Storage error and reports nothing removed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: [P1], error: null }, { data: null, error: { message: "boom" } });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it("never throws, even when the client throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { rpc: vi.fn(async () => Promise.reject(new Error("network"))) } as never;
    await expect(cleanupAttachmentOrphans(client, PROJECT)).resolves.toBe(0);
    expect(log).toHaveBeenCalled();
  });
});
