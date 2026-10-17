import { afterEach, describe, expect, it, vi } from "vitest";
import { qoyodRequest } from "./client";
afterEach(() => vi.unstubAllGlobals());
describe("Qoyod transport uncertainty", () => {
  it("uses fixed HTTPS destination and never follows redirects with the key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await qoyodRequest("synthetic-key", "journal_entries", { journal_entry: {} })).toEqual({ id: 3 });
    expect(fetcher).toHaveBeenCalledWith("https://api.qoyod.com/2.0/journal_entries", expect.objectContaining({ redirect: "error", method: "POST" }));
  });
  it.each([500, 502, 408])("keeps POST %s uncertain", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("server failure", { status })));
    await expect(qoyodRequest("synthetic-key", "journal_entries", {})).rejects.toMatchObject({ uncertain: true });
  });
  it("does not retry a network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetcher);
    await expect(qoyodRequest("synthetic-key", "journal_entries", {})).rejects.toMatchObject({ uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows correcting a confirmed validation refusal without exposing response contents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private remote details", { status: 422 })));
    await expect(qoyodRequest("synthetic-key", "journal_entries", {})).rejects.toMatchObject({ uncertain: false, message: "قيود: HTTP 422" });
  });
  it("treats a malformed successful POST response as uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid json", { status: 200 })));
    await expect(qoyodRequest("synthetic-key", "journal_entries", {})).rejects.toMatchObject({ uncertain: true });
  });
});
