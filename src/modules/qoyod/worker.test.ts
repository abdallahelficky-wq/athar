import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), txUpdate: vi.fn(), request: vi.fn() }));
vi.mock("../../lib/prisma", () => ({ prisma: {
  qoyodJournalExport: { findFirst: fake.findFirst, updateMany: fake.updateMany, update: fake.update },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(), qoyodJournalExport: { findUnique: fake.findUnique, update: fake.txUpdate } }),
} }));
vi.mock("../../lib/zatca/secretBox", () => ({ decryptSecret: () => "synthetic-key" }));
vi.mock("./client", async importOriginal => ({ ...await importOriginal<typeof import("./client")>(), qoyodRequest: fake.request }));
import { dispatchQoyodJournal } from "./worker";
import { QoyodFailure } from "./client";
const job = () => ({ entryId: "j", companyId: "c", status: "queued", connection: { enabled: true, apiKeyEnc: "encrypted", mapping: { accounts: { a: 1, b: 2 }, contacts: {} } }, entry: {
  id: "j", companyId: "c", status: "posted", entryNumber: "J1", date: new Date("2026-10-15"), memo: "test", company: { currency: "SAR" },
  lines: [{ accountId: "a", debit: "1.00", credit: "0", description: null }, { accountId: "b", debit: "0", credit: "1.00", description: null }],
} });
beforeEach(() => { vi.resetAllMocks(); fake.findFirst.mockResolvedValue({ entryId: "j", companyId: "c" }); fake.findUnique.mockResolvedValue(job()); fake.request.mockResolvedValue({ id: 44 }); });
describe("Qoyod dispatch state", () => {
  it("persists sending before the network call and records receipt", async () => {
    await dispatchQoyodJournal();
    expect(fake.txUpdate.mock.invocationCallOrder[0]).toBeLessThan(fake.request.mock.invocationCallOrder[0]);
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "sent", remoteId: 44 }) }));
  });
  it.each(["sending", "sent", "uncertain", "blocked"])("does not dispatch a stale candidate now %s", async status => {
    fake.findUnique.mockResolvedValue({ ...job(), status }); await dispatchQoyodJournal(); expect(fake.request).not.toHaveBeenCalled();
  });
  it("rechecks disable after claiming candidate", async () => {
    const row=job(); row.connection.enabled=false; fake.findUnique.mockResolvedValue(row); await dispatchQoyodJournal(); expect(fake.request).not.toHaveBeenCalled();
  });
  it("blocks missing mapping without sending", async () => {
    const row=job(); row.connection.mapping.accounts.a=0; fake.findUnique.mockResolvedValue(row); await dispatchQoyodJournal(); expect(fake.request).not.toHaveBeenCalled();
    expect(fake.txUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "blocked" }) }));
  });
  it("holds uncertain outcomes without another POST", async () => {
    fake.request.mockRejectedValue(new QoyodFailure(true)); await dispatchQoyodJournal(); expect(fake.request).toHaveBeenCalledTimes(1);
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "uncertain" }) }));
  });
  it("leaves sending if acknowledgement persistence fails", async () => {
    fake.update.mockRejectedValue(new Error("database unavailable")); await expect(dispatchQoyodJournal()).rejects.toThrow(); expect(fake.request).toHaveBeenCalledTimes(1); expect(fake.update).toHaveBeenCalledTimes(1);
  });
});
