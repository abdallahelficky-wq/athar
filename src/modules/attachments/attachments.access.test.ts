import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../config/env", () => ({ env: {} }));
vi.mock("../../lib/prisma", () => ({ prisma: {
  journalEntry: { findFirst: vi.fn() }, attachment: { findFirst: vi.fn() },
} }));
vi.mock("./attachments.service", () => ({ listAttachments: vi.fn(), createAttachment: vi.fn(), deleteAttachment: vi.fn() }));
import { prisma } from "../../lib/prisma";
import * as service from "./attachments.service";
import { listHandler, createHandler, deleteHandler } from "./attachments.controller";

beforeEach(() => vi.resetAllMocks());
describe("attachment access requires a parent in the current tenant", () => {
  it.each(["all", "company-a"])("rejects missing/foreign parents for scope %s before touching files", async companyScope => {
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.attachment.findFirst).mockResolvedValue({ entityType: "journal_entry", entityId: "missing" } as any);
    const req: any = {
      auth: { sub: "admin", tenantId: "tenant-a", companyScope, role: "admin" },
      query: { entityType: "journal_entry", entityId: "missing" },
      body: { entityType: "journal_entry", entityId: "missing" },
      params: { id: "orphan" }, file: { originalname: "test.xlsx", mimetype: "application/octet-stream", buffer: Buffer.alloc(0) },
    };
    for (const handler of [listHandler, createHandler, deleteHandler]) {
      await expect(handler(req, {} as any, vi.fn())).rejects.toMatchObject({ status: 404 });
    }
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({ where: { id: "missing", tenantId: "tenant-a" }, select: { companyId: true } });
    expect(service.listAttachments).not.toHaveBeenCalled();
    expect(service.createAttachment).not.toHaveBeenCalled();
    expect(service.deleteAttachment).not.toHaveBeenCalled();
  });
  it.each(["original", "mirror", "reversal", "reversed-mirror"])("checks the actual %s parent company", async entityId => {
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue({ companyId: "company-b" } as any);
    const req: any = { auth: { tenantId: "tenant-a", companyScope: "company-a", role: "admin" }, query: { entityType: "journal_entry", entityId } };
    await expect(listHandler(req, {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
    expect(service.listAttachments).not.toHaveBeenCalled();
  });
  it.each(["all", "company-a"])("allows a valid parent for scope %s", async companyScope => {
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue({ companyId: "company-a" } as any);
    vi.mocked(service.listAttachments).mockResolvedValue([]);
    const res: any = { json: vi.fn() };
    await listHandler({ auth: { tenantId: "tenant-a", companyScope, role: "admin" }, query: { entityType: "journal_entry", entityId: "valid" } } as any, res, vi.fn());
    expect(service.listAttachments).toHaveBeenCalledWith("tenant-a", "journal_entry", "valid");
    expect(res.json).toHaveBeenCalledWith([]);
  });
});
