import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { inflateRawSync, gunzipSync } from "zlib";
import { createHash } from "crypto";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { writeZatcaArchiveTx, annex1FileName } from "../../lib/zatca/archive";

/**
 * أرشيف مستندات زاتكا على Postgres فعلي:
 * - الجدول للإضافة فقط: التعديل والحذف مرفوضان من قاعدة البيانات نفسها؛
 * - الاستكمال الرجعي في الترحيل يحفظ ملف XML المُخلَّص من ردود زاتكا المحفوظة، ويتخطّى القيم التالفة بلا إسقاط الترحيل؛
 * - التصدير (الملحق 1): ملف ZIP بأسماء {الرقم الضريبي}_{التاريخ}T{الوقت}_{رقم المستند}.xml من المستند نفسه،
 *   بالمستند المُخلَّص للقياسي، وmanifest.csv يسرد المستندات المقبولة بلا أصل محفوظ (الفجوة) عدداً لا تقديراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `zatca-archive-${stamp}@example.com`;
const VAT = "310000000000003";
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let otherCompanyId = "";
let revenueId = "";
let customerId = "";

function docXml(number: string, date: string, time: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice><cbc:ID>${number}</cbc:ID><cbc:IssueDate>${date}</cbc:IssueDate><cbc:IssueTime>${time}</cbc:IssueTime>` +
    `<cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>${VAT}</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty></Invoice>`;
}

async function call(method: string, path: string, as = token) {
  const res = await fetch(`${baseUrl}/api${path}`, { method, headers: { authorization: `Bearer ${as}` } });
  return res;
}

/** قارئ ZIP مستقل (الدليل المركزي + inflateRaw) — لا يعتمد على كاتب الأرشيف */
function readZip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function invoice(date: string) {
  const res = await fetch(`${baseUrl}/api/sales-invoices`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ companyId, customerId, date, post: true, lines: [{ accountId: revenueId, description: "بند", quantity: 1, unitPrice: 115, priceIncludesVat: true }] }),
  });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(201);
  return prisma.salesInvoice.findUniqueOrThrow({ where: { id: body.id ?? body.invoice?.id } });
}

describe("ZATCA document archive (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `أرشيف زاتكا ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    await prisma.company.update({ where: { id: companyId }, data: { vatNumber: VAT } });
    revenueId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    const c = await fetch(`${baseUrl}/api/customers`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ companyId, name: "عميل" }),
    });
    customerId = (await c.json()).id;
    const other = await fetch(`${baseUrl}/api/companies`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ name: `شركة أخرى ${stamp}`, businessActivity: "retail" }),
    });
    otherCompanyId = (await other.json()).id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    // صفوف الأرشيف تبقى (للإضافة فقط، بلا مفتاح أجنبي يمنع حذف المستأجر)
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email: { startsWith: `zatca-archive-` } } });
  });

  it("is append-only: the database itself refuses update and delete", async () => {
    const inv = await invoice("2026-09-01T09:00:00.000Z");
    await prisma.$transaction((tx) => writeZatcaArchiveTx(tx, {
      tenantId, companyId, documentType: "sales_invoice", documentId: inv.id, documentNumber: inv.invoiceNumber, documentUuid: inv.zatcaUuid,
    }, { signedXml: docXml(inv.invoiceNumber, "2026-09-01", "09:00:00"), subtype: "simplified", icv: 1, invoiceHash: "h1", issuedAt: new Date("2026-09-01T09:00:00Z") }, "submission"));
    const row = await prisma.zatcaDocumentArchive.findFirstOrThrow({ where: { documentId: inv.id } });
    await expect(prisma.zatcaDocumentArchive.update({ where: { id: row.id }, data: { documentNumber: "X" } })).rejects.toThrow(/append-only/);
    await expect(prisma.zatcaDocumentArchive.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "zatca_document_archive"`)).rejects.toThrow(/append-only/);
    expect(await prisma.zatcaDocumentArchive.count({ where: { id: row.id } })).toBe(1);
  });

  it("the migration's backfill keeps the cleared XML found in stored ZATCA responses, and skips a malformed one instead of failing", async () => {
    const good = await invoice("2026-08-10T09:00:00.000Z");
    const bad = await invoice("2026-08-11T09:00:00.000Z");
    const clearedXml = docXml(good.invoiceNumber, "2026-08-10", "09:00:00");
    await prisma.salesInvoice.update({ where: { id: good.id }, data: { zatcaStatus: "cleared", icv: 7, invoiceHash: "hg", zatcaSubmittedAt: new Date("2026-08-10T09:00:00Z"), zatcaResponseRaw: { clearedInvoice: Buffer.from(clearedXml).toString("base64") } } });
    await prisma.salesInvoice.update({ where: { id: bad.id }, data: { zatcaStatus: "cleared", icv: 8, invoiceHash: "hb", zatcaSubmittedAt: new Date("2026-08-11T09:00:00Z"), zatcaResponseRaw: { clearedInvoice: "@@not base64@@" } } });

    const sql = readFileSync("prisma/migrations/20260928140000_zatca_document_archive/migration.sql", "utf8");
    const insert = sql.slice(sql.indexOf('INSERT INTO "zatca_document_archive"'), sql.indexOf("INSERT INTO", sql.indexOf('INSERT INTO "zatca_document_archive"') + 10));
    // نفس جملة الترحيل حرفياً، مقصورة على مستأجر هذا الاختبار
    await prisma.$executeRawUnsafe(insert.trim().replace(/;$/, "") + ` AND d."tenantId" = '${tenantId}'`);

    const row = await prisma.zatcaDocumentArchive.findFirstOrThrow({ where: { documentId: good.id } });
    expect(row).toMatchObject({ source: "backfill", compression: "none", subtype: "standard", submissionKind: "clearance", signedXml: null, sellerVatNumber: VAT });
    expect(Buffer.from(row.clearedXml!).toString()).toBe(clearedXml);
    expect(row.clearedXmlSha256).toBe(createHash("sha256").update(clearedXml).digest("hex"));
    expect(await prisma.zatcaDocumentArchive.count({ where: { documentId: bad.id } })).toBe(0);
  });

  it("exports the period as Annex 1 files named from the document itself, with a manifest that counts the gap", async () => {
    const cleared = await invoice("2026-09-15T10:15:00.000Z");
    const reportedNoOriginal = await invoice("2026-09-16T11:00:00.000Z");
    const outside = await invoice("2026-10-02T08:00:00.000Z");
    const signed = docXml(cleared.invoiceNumber, "2026-09-15", "10:15:00");
    const clearedByZatca = docXml(cleared.invoiceNumber, "2026-09-15", "10:15:00").replace("<Invoice>", "<Invoice><!-- stamped by ZATCA -->");
    await prisma.salesInvoice.update({ where: { id: cleared.id }, data: { zatcaStatus: "cleared", zatcaSubmittedAt: new Date("2026-09-15T10:15:00Z") } });
    await prisma.salesInvoice.update({ where: { id: reportedNoOriginal.id }, data: { zatcaStatus: "reported", icv: 21, zatcaSubmittedAt: new Date("2026-09-16T11:00:00Z") } });
    for (const [inv, at, xml, cl] of [[cleared, "2026-09-15T10:15:00Z", signed, clearedByZatca], [outside, "2026-10-02T08:00:00Z", docXml(outside.invoiceNumber, "2026-10-02", "08:00:00"), undefined]] as const) {
      await prisma.$transaction((tx) => writeZatcaArchiveTx(tx, {
        tenantId, companyId, documentType: "sales_invoice", documentId: inv.id, documentNumber: inv.invoiceNumber, documentUuid: inv.zatcaUuid,
      }, { signedXml: xml, clearedInvoiceBase64: cl ? Buffer.from(cl).toString("base64") : undefined, subtype: cl ? "standard" : "simplified", icv: 20, invoiceHash: "h", issuedAt: new Date(at) }, "submission"));
    }

    const res = await call("GET", `/zatca-archive/export?companyId=${companyId}&from=2026-09-15&to=2026-09-30`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/zip");
    expect(res.headers.get("x-missing-count")).toBe("1");
    const files = readZip(Buffer.from(await res.arrayBuffer()));

    const expectedName = `${VAT}_20260915T101500_${cleared.invoiceNumber.replace(/[^0-9A-Za-z]+/g, "-")}.xml`;
    expect([...files.keys()].sort()).toEqual([expectedName, "manifest.csv"].sort());
    // القياسي: المستند المُخلَّص من زاتكا هو المُصدَّر
    expect(files.get(expectedName)!.toString()).toBe(clearedByZatca);
    const manifest = files.get("manifest.csv")!.toString();
    expect(manifest).toContain(`${cleared.invoiceNumber},${cleared.zatcaUuid}`);
    expect(manifest).toMatch(new RegExp(`${reportedNoOriginal.invoiceNumber},.*,missing,`));
    expect(manifest).not.toContain(outside.invoiceNumber);

    // الأرشيف لم يتغيّر بالتصدير، وما فيه يطابق بصمته
    const stored = await prisma.zatcaDocumentArchive.findFirstOrThrow({ where: { documentId: cleared.id } });
    expect(createHash("sha256").update(gunzipSync(Buffer.from(stored.signedXml!))).digest("hex")).toBe(stored.signedXmlSha256);
  });

  it("the Annex 1 name comes from the document, not from editable records", () => {
    const xml = docXml("INV/2026/0007", "2026-01-05", "23:59:07");
    expect(annex1FileName(xml, { sellerVatNumber: "999", issuedAt: new Date("2020-01-01"), documentNumber: "OTHER" })).toBe(`${VAT}_20260105T235907_INV-2026-0007.xml`);
  });

  it("export is company-scoped and not open to view-only users", async () => {
    const identity = await prisma.identity.create({ data: { email: `zatca-archive-v-${stamp}@example.com` } });
    const viewer = await prisma.user.create({ data: { tenantId, identityId: identity.id, name: "مشاهد", role: "viewer", companyScope: "all", inviteStatus: "accepted" } });
    const viewerToken = signAccessToken({ sub: viewer.id, tenantId, role: "viewer", companyScope: "all", readOnly: false });
    expect((await call("GET", `/zatca-archive/export?companyId=${companyId}&from=2026-09-01&to=2026-09-30`, viewerToken)).status).toBe(403);

    const identity2 = await prisma.identity.create({ data: { email: `zatca-archive-s-${stamp}@example.com` } });
    const scoped = await prisma.user.create({ data: { tenantId, identityId: identity2.id, name: "محاسب", role: "accountant", companyScope: otherCompanyId, inviteStatus: "accepted" } });
    const scopedToken = signAccessToken({ sub: scoped.id, tenantId, role: "accountant", companyScope: otherCompanyId, readOnly: false });
    expect((await call("GET", `/zatca-archive/export?companyId=${companyId}&from=2026-09-01&to=2026-09-30`, scopedToken)).status).toBe(403);
    expect((await call("GET", `/zatca-archive/export?companyId=${otherCompanyId}&from=2026-09-01&to=2026-09-30`, scopedToken)).status).toBe(200);
    expect((await call("GET", `/zatca-archive/export?companyId=${companyId}`)).status).toBe(400);
  });
});
