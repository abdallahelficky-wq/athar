import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import { createHash } from "crypto";
import { gunzipSync } from "zlib";

/**
 * إعادة إصدار مستند قياسي رفضته زاتكا — على Postgres فعلي، عبر HTTP، بالتوقيع الحقيقي (signDocument) وبناء المستند الحقيقي.
 * الشيء الوحيد المُموَّه هو ردّ زاتكا نفسه (يصل من الخارج فعلاً — CLAUDE.md القاعدة 2): رفض بقاعدة، قبول يعيد المستند المُرسَل
 * نفسه كمُخلَّص، أو تعذّر اتصال. لا اتصال بزاتكا إطلاقاً.
 */
const zatca = vi.hoisted(() => ({
  mode: "accept" as "accept" | "reject" | "network",
  calls: [] as { kind: string; uuid: string; invoiceHash: string; xml: string }[],
}));
vi.mock("../../lib/zatca/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/zatca/apiClient")>();
  const respond = (kind: "clearance" | "reporting") => async (params: { uuid: string; invoiceHash: string; signedInvoiceBase64: string }) => {
    zatca.calls.push({ kind, uuid: params.uuid, invoiceHash: params.invoiceHash, xml: Buffer.from(params.signedInvoiceBase64, "base64").toString("utf8") });
    if (zatca.mode === "network") return { ok: false, status: 0, data: null, networkError: true };
    if (zatca.mode === "reject") {
      return {
        ok: false, status: 400, statusText: "Bad Request", httpError: false,
        data: {
          clearanceStatus: "NOT_CLEARED",
          validationResults: {
            status: "ERROR", infoMessages: [], warningMessages: [],
            errorMessages: [{ type: "ERROR", code: "BR-KSA-15", category: "KSA", message: "supply date missing", status: "ERROR" }],
          },
        },
      };
    }
    return {
      ok: true, status: 200,
      data: kind === "clearance"
        ? { clearanceStatus: "CLEARED", clearedInvoice: params.signedInvoiceBase64, validationResults: { status: "PASS", infoMessages: [], warningMessages: [], errorMessages: [] } }
        : { reportingStatus: "REPORTED", validationResults: { status: "PASS", infoMessages: [], warningMessages: [], errorMessages: [] } },
    };
  };
  const never = (name: string) => () => { throw new Error(`${name} must not be called`); };
  return {
    ...actual,
    clearInvoice: vi.fn(respond("clearance")),
    reportInvoice: vi.fn(respond("reporting")),
    checkInvoiceCompliance: vi.fn(never("checkInvoiceCompliance")),
    requestComplianceCsid: vi.fn(never("requestComplianceCsid")),
    requestProductionCsid: vi.fn(never("requestProductionCsid")),
  };
});

import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { encryptSecret } from "../../lib/zatca/secretBox";
import { computeDocumentHash } from "../../lib/zatca/hash";

guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailPrefix = `zatca-reissue-${stamp}`;
const SELLER_VAT = "310000000000003";
let server: Server;
let baseUrl = "";
let token = "";
let viewerToken = "";
let otherTenantToken = "";
let tenantId = "";
let otherTenantId = "";
let companyId = "";
let revenueId = "";
let standardCustomerId = "";
let simplifiedCustomerId = "";

const keyDir = mkdtempSync(path.join(tmpdir(), "zatca-reissue-it-"));
execFileSync("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", path.join(keyDir, "key.pem")]);
execFileSync("openssl", ["req", "-x509", "-key", path.join(keyDir, "key.pem"), "-sha256", "-days", "1", "-subj", "/CN=zatca-test", "-out", path.join(keyDir, "cert.pem")]);
const privateKeyPem = readFileSync(path.join(keyDir, "key.pem"), "utf8");
const certificatePem = readFileSync(path.join(keyDir, "cert.pem"), "utf8");
rmSync(keyDir, { recursive: true, force: true });

async function api(method: string, url: string, body?: unknown, as = token) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${as}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text };
}

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const tag = (xml: string, name: string) => xml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "").match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
const company = () => prisma.company.findUniqueOrThrow({ where: { id: companyId } });

async function postInvoice(customerId: string, date = "2026-09-15T00:00:00.000Z") {
  const r = await api("POST", "/sales-invoices", {
    companyId, customerId, date, post: true,
    lines: [{ accountId: revenueId, description: "خدمة", quantity: 3, unitPrice: 73.3333, priceIncludesVat: true }],
  });
  expect(r.status, r.text).toBe(201);
  return prisma.salesInvoice.findUniqueOrThrow({ where: { id: r.body.id }, include: { lines: true } });
}

async function rejectedInvoice(date?: string) {
  zatca.mode = "reject";
  const inv = await postInvoice(standardCustomerId, date);
  expect(inv.status).toBe("pending_submission");
  expect(inv.zatcaStatus).toBe("rejected");
  return inv;
}

describe("ZATCA re-issue of rejected standard documents (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `إعادة إصدار ${stamp}`, businessActivity: "retail", name: "المالك", email: `${emailPrefix}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    await prisma.company.update({
      where: { id: companyId },
      data: {
        vatNumber: SELLER_VAT, crNumber: "1010101010", addressStreet: "طريق الملك فهد", addressBuilding: "1234", addressDistrict: "العليا",
        addressCity: "الرياض", addressPostalCode: "12345", zatcaOnboardingStatus: "production", zatcaEnvironment: "sandbox",
      },
    });
    await prisma.companyZatcaCredential.create({
      data: {
        companyId, privateKeyEnc: encryptSecret(privateKeyPem),
        productionCertEnc: encryptSecret(certificatePem), productionSecretEnc: encryptSecret("test-secret"),
      } as never,
    });
    revenueId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    const std = await api("POST", "/customers", {
      companyId, name: "شركة المشتري", customerType: "business", vatNumber: "300000000000003",
      street: "شارع الأمير", buildingNo: "4321", postalCode: "54321", city: "جدة", district: "الروضة",
    });
    expect(std.status, std.text).toBe(201);
    standardCustomerId = std.body.id;
    const simp = await api("POST", "/customers", { companyId, name: "فرد", customerType: "individual" });
    expect(simp.status, simp.text).toBe(201);
    simplifiedCustomerId = simp.body.id;

    const identity = await prisma.identity.create({ data: { email: `${emailPrefix}-viewer@example.com` } });
    const viewer = await prisma.user.create({ data: { tenantId, identityId: identity.id, name: "مشاهد", role: "viewer", companyScope: "all", inviteStatus: "accepted" } });
    viewerToken = signAccessToken({ sub: viewer.id, tenantId, role: "viewer", companyScope: "all", readOnly: false });
    const other = await register({ tenantName: `مستأجر آخر ${stamp}`, businessActivity: "retail", name: "آخر", email: `${emailPrefix}-other@example.com`, password: "Str0ng-Pass!" });
    otherTenantId = other.tenant.id;
    otherTenantToken = other.accessToken;
  }, 120_000);

  beforeEach(() => {
    zatca.calls.length = 0;
    zatca.mode = "accept";
  });

  afterAll(async () => {
    server?.close();
    // سجلّا الإصدارات والمحاولات والأرشيف تبقى (للإضافة فقط، بلا مفاتيح أجنبية)
    for (const t of [tenantId, otherTenantId]) {
      await prisma.salesReturn.deleteMany({ where: { tenantId: t } });
      await prisma.salesDebitNote.deleteMany({ where: { tenantId: t } });
      await prisma.salesInvoice.deleteMany({ where: { tenantId: t } });
      await prisma.customer.deleteMany({ where: { tenantId: t } });
      await prisma.stockMovement.deleteMany({ where: { tenantId: t } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: t } });
      await prisma.companyZatcaCredential.deleteMany({ where: { company: { tenantId: t } } });
      await prisma.tenant.update({ where: { id: t }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  });

  it("re-issues a rejected invoice: same number, new UUID/ICV/hash, PIH = last generated hash, supply date kept, chain continues", async () => {
    const rejected = await rejectedInvoice();
    const [issue1] = await prisma.zatcaDocumentIssue.findMany({ where: { documentId: rejected.id } });
    expect(issue1).toMatchObject({ documentUuid: rejected.zatcaUuid, icv: rejected.icv, invoiceHash: rejected.invoiceHash, source: "issue", supplyDate: null });
    // XML غير الموقَّع المحفوظ هو ما حُسبت عليه التجزئة فعلاً
    expect(computeDocumentHash(gunzipSync(Buffer.from(issue1.unsignedXml!)).toString("utf8"))).toBe(rejected.invoiceHash);
    const [attempt1] = await prisma.zatcaSubmissionAttempt.findMany({ where: { documentId: rejected.id } });
    expect(attempt1).toMatchObject({ outcome: "rejected", submissionKind: "clearance", documentUuid: rejected.zatcaUuid, source: "submission" });
    expect(attempt1.signedXmlSha256).toBe(sha256(zatca.calls[0].xml));
    expect(attempt1.reason).toContain("BR-KSA-15");
    const nextIcvBefore = (await company()).zatcaNextIcv;
    const lastHashBefore = (await company()).zatcaLastInvoiceHash;
    expect(lastHashBefore).toBe(rejected.invoiceHash);

    zatca.mode = "accept";
    zatca.calls.length = 0;
    const r = await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`);
    expect(r.status, r.text).toBe(200);
    const reissued = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(reissued.status).toBe("posted");
    expect(reissued.zatcaStatus).toBe("cleared");
    expect(reissued.invoiceNumber).toBe(rejected.invoiceNumber);
    expect(reissued.zatcaUuid).not.toBe(rejected.zatcaUuid);
    expect(reissued.icv).toBe(nextIcvBefore);
    expect(reissued.previousInvoiceHash).toBe(rejected.invoiceHash);
    expect(reissued.invoiceHash).not.toBe(rejected.invoiceHash);
    expect(reissued.date.toISOString()).toBe(rejected.date.toISOString());
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: reissued.journalEntryId! } });
    expect(entry.date.toISOString()).toBe(rejected.date.toISOString());

    // ما أُرسِل فعلاً: نفس BT-1، UUID/ICV/PIH الجديدة، IssueDate = اليوم، وKSA-5 = تاريخ الفاتورة الأصلي
    const sent = zatca.calls[0].xml;
    expect(zatca.calls).toHaveLength(1);
    expect(zatca.calls[0].uuid).toBe(reissued.zatcaUuid);
    expect(tag(sent, "cbc:ID")).toBe(rejected.invoiceNumber);
    expect(tag(sent, "cbc:UUID")).toBe(reissued.zatcaUuid);
    expect(tag(sent, "cbc:IssueDate")).toBe(reissued.zatcaSubmittedAt!.toISOString().slice(0, 10));
    expect(tag(sent, "cbc:ActualDeliveryDate")).toBe("2026-09-15");
    expect(sent).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${rejected.invoiceHash}</cbc:EmbeddedDocumentBinaryObject>`);

    // الإصدار المرفوض باقٍ كما هو؛ الجديد مرتبط به
    const issues = await prisma.zatcaDocumentIssue.findMany({ where: { documentId: rejected.id }, orderBy: { icv: "asc" } });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual(issue1);
    expect(issues[1]).toMatchObject({ documentUuid: reissued.zatcaUuid, icv: reissued.icv, previousInvoiceHash: rejected.invoiceHash, invoiceHash: reissued.invoiceHash, source: "reissue", reissueOfIssueId: issue1.id, supplyDate: "2026-09-15", documentNumber: rejected.invoiceNumber });
    expect(computeDocumentHash(gunzipSync(Buffer.from(issues[1].unsignedXml!)).toString("utf8"))).toBe(reissued.invoiceHash);
    const attempts = await prisma.zatcaSubmissionAttempt.findMany({ where: { documentId: rejected.id }, orderBy: { attemptedAt: "asc" } });
    expect(attempts.map((a) => [a.documentUuid, a.outcome])).toEqual([[rejected.zatcaUuid, "rejected"], [reissued.zatcaUuid, "cleared"]]);
    // الأرشيف يحفظ المقبول وحده — المستند المُعاد إصداره
    const archived = await prisma.zatcaDocumentArchive.findMany({ where: { documentId: rejected.id } });
    expect(archived.map((a) => a.documentUuid)).toEqual([reissued.zatcaUuid]);

    // المستند التالي في الشركة يتسلسل بعد المُعاد إصداره
    const next = await postInvoice(simplifiedCustomerId);
    expect(next.icv).toBe(reissued.icv! + 1);
    expect(next.previousInvoiceHash).toBe(reissued.invoiceHash);
  });

  it("the database refuses reusing an ICV or UUID, and refuses changing or deleting issue/attempt rows", async () => {
    const inv = await rejectedInvoice();
    const issue = await prisma.zatcaDocumentIssue.findFirstOrThrow({ where: { documentUuid: inv.zatcaUuid } });
    const { id: _id, createdAt: _c, ...copy } = issue;
    await expect(prisma.zatcaDocumentIssue.create({ data: { ...copy, documentUuid: "11111111-2222-4333-8444-555555555555" } as never })).rejects.toThrow(/Unique constraint/);
    await expect(prisma.zatcaDocumentIssue.create({ data: { ...copy, icv: 999_999 } as never })).rejects.toThrow(/Unique constraint/);
    await expect(prisma.zatcaDocumentIssue.update({ where: { id: issue.id }, data: { invoiceHash: "changed" } })).rejects.toThrow(/append-only/);
    await expect(prisma.zatcaDocumentIssue.delete({ where: { id: issue.id } })).rejects.toThrow(/append-only/);
    const attempt = await prisma.zatcaSubmissionAttempt.findFirstOrThrow({ where: { documentUuid: inv.zatcaUuid } });
    await expect(prisma.zatcaSubmissionAttempt.update({ where: { id: attempt.id }, data: { outcome: "cleared" } })).rejects.toThrow(/append-only/);
    await expect(prisma.zatcaSubmissionAttempt.delete({ where: { id: attempt.id } })).rejects.toThrow(/append-only/);
  });

  it("re-issue is the only way to a new UUID/ICV under the same number, and only for a rejected standard document", async () => {
    // مقبولة ومرحَّلة
    zatca.mode = "accept";
    const cleared = await postInvoice(standardCustomerId);
    expect(cleared.zatcaStatus).toBe("cleared");
    const r1 = await api("POST", `/sales-invoices/${cleared.id}/reissue-zatca`);
    expect(r1.status).toBe(400);
    // تعذّر اتصال — مسارها إعادة المحاولة بنفس المعرّفات، لا إعادة إصدار
    zatca.mode = "network";
    const failed = await postInvoice(standardCustomerId);
    expect(failed.zatcaStatus).toBe("submission_failed");
    const r2 = await api("POST", `/sales-invoices/${failed.id}/reissue-zatca`);
    expect(r2.status).toBe(400);
    // مبسّطة مرفوضة: لا إعادة إصدار (القياسي فقط)
    zatca.mode = "reject";
    const simp = await postInvoice(simplifiedCustomerId);
    expect(simp.zatcaStatus).toBe("rejected");
    const r3 = await api("POST", `/sales-invoices/${simp.id}/reissue-zatca`);
    expect(r3.status).toBe(400);
    // إعادة المحاولة العادية على المرفوضة تُبقي نفس UUID/ICV
    const rej = await rejectedInvoice();
    const retry = await api("POST", `/sales-invoices/${rej.id}/retry-zatca-submission`);
    expect(retry.status, retry.text).toBe(200);
    const after = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: rej.id } });
    expect([after.zatcaUuid, after.icv, after.invoiceHash]).toEqual([rej.zatcaUuid, rej.icv, rej.invoiceHash]);
    expect(await prisma.zatcaDocumentIssue.count({ where: { documentId: rej.id } })).toBe(1);
  });

  it("two simultaneous re-issue clicks produce exactly one new issue and consume exactly one ICV", async () => {
    const rejected = await rejectedInvoice();
    const nextIcvBefore = (await company()).zatcaNextIcv;
    zatca.mode = "reject";
    const results = await Promise.all([1, 2].map(() => api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.zatcaDocumentIssue.count({ where: { documentId: rejected.id } })).toBe(2);
    expect((await company()).zatcaNextIcv).toBe(nextIcvBefore + 1);
    // رُفض الإصدار الثاني أيضاً — يمكن إعادة إصداره مرة أخرى، والسلسلة تبقى متصلة عبر الإصدارات الثلاثة
    const r = await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`);
    expect(r.status, r.text).toBe(200);
    const issues = await prisma.zatcaDocumentIssue.findMany({ where: { documentId: rejected.id }, orderBy: { icv: "asc" } });
    expect(issues).toHaveLength(3);
    expect(new Set(issues.map((i) => i.documentUuid)).size).toBe(3);
    expect(issues[2].reissueOfIssueId).toBe(issues[1].id);
    expect(issues[1].reissueOfIssueId).toBe(issues[0].id);
  });

  it("a re-issued document that then fails to reach ZATCA retries with the same identifiers and its supply date", async () => {
    const rejected = await rejectedInvoice();
    zatca.mode = "network";
    const r = await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`);
    expect(r.status, r.text).toBe(200);
    const pending = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(pending.zatcaStatus).toBe("submission_failed");
    zatca.mode = "accept";
    zatca.calls.length = 0;
    const retry = await api("POST", `/sales-invoices/${rejected.id}/retry-zatca-submission`);
    expect(retry.status, retry.text).toBe(200);
    const done = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(done.zatcaStatus).toBe("cleared");
    expect([done.zatcaUuid, done.icv, done.invoiceHash]).toEqual([pending.zatcaUuid, pending.icv, pending.invoiceHash]);
    expect(tag(zatca.calls[0].xml, "cbc:ActualDeliveryDate")).toBe("2026-09-15");
  });

  it("requires the posting permission", async () => {
    const rejected = await rejectedInvoice();
    const r = await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`, undefined, viewerToken);
    expect(r.status).toBe(403);
    const after = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(after.zatcaUuid).toBe(rejected.zatcaUuid);
  });

  it("refuses when the original date is in a closed fiscal period, reserving nothing", async () => {
    const rejected = await rejectedInvoice("2026-08-10T00:00:00.000Z");
    const before = await company();
    await prisma.company.update({ where: { id: companyId }, data: { fiscalYearClosingDate: new Date("2026-08-31T00:00:00.000Z") } });
    try {
      const r = await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`);
      expect(r.status).toBe(400);
      expect(r.body.error ?? r.text).toContain("فترة مُقفلة");
      const after = await company();
      expect(after.zatcaNextIcv).toBe(before.zatcaNextIcv);
      expect(after.zatcaLastInvoiceHash).toBe(before.zatcaLastInvoiceHash);
      const row = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: rejected.id } });
      expect([row.zatcaUuid, row.zatcaStatus]).toEqual([rejected.zatcaUuid, "rejected"]);
      expect(await prisma.zatcaDocumentIssue.count({ where: { documentId: rejected.id } })).toBe(1);
    } finally {
      await prisma.company.update({ where: { id: companyId }, data: { fiscalYearClosingDate: null } });
    }
  });

  it("re-issues rejected standard credit notes and debit notes the same way", async () => {
    zatca.mode = "accept";
    const original = await postInvoice(standardCustomerId);
    expect(original.zatcaStatus).toBe("cleared");

    for (const kind of ["credit", "debit"] as const) {
      zatca.mode = "reject";
      const url = kind === "credit" ? "/sales-returns" : "/sales-debit-notes";
      const created = await api("POST", url, {
        companyId, customerId: standardCustomerId, relatedInvoiceId: original.id, date: "2026-09-20T00:00:00.000Z", reason: "تصحيح سعر",
        lines: kind === "credit"
          ? [{ originalInvoiceLineId: original.lines[0].id, accountId: revenueId, quantity: 1, unitPrice: 73.3333 }]
          : [{ accountId: revenueId, description: "فرق سعر", quantity: 1, unitPrice: 11.5 }],
      });
      expect(created.status, created.text).toBe(201);
      const find = (id: string) => kind === "credit"
        ? prisma.salesReturn.findUniqueOrThrow({ where: { id } })
        : prisma.salesDebitNote.findUniqueOrThrow({ where: { id } });
      const rejected = await find(created.body.id);
      expect(rejected.zatcaStatus).toBe("rejected");
      const lastHash = (await company()).zatcaLastInvoiceHash;

      zatca.mode = "accept";
      zatca.calls.length = 0;
      const denied = await api("POST", `${url}/${rejected.id}/reissue-zatca`, undefined, viewerToken);
      expect(denied.status).toBe(403);
      const r = await api("POST", `${url}/${rejected.id}/reissue-zatca`);
      expect(r.status, r.text).toBe(200);
      const done = await find(rejected.id);
      expect(done.status).toBe("posted");
      expect(done.zatcaStatus).toBe("cleared");
      expect(done.zatcaUuid).not.toBe(rejected.zatcaUuid);
      expect(done.icv).toBe(rejected.icv! + 1);
      expect(done.previousInvoiceHash).toBe(lastHash);
      const sent = zatca.calls[0].xml;
      expect(tag(sent, "cbc:ID")).toBe(kind === "credit" ? (rejected as { returnNumber: string }).returnNumber : (rejected as { debitNoteNumber: string }).debitNoteNumber);
      expect(tag(sent, "cbc:ActualDeliveryDate")).toBe("2026-09-20");
      expect(sent).toContain(`<cbc:ID>${original.invoiceNumber}</cbc:ID>`); // BillingReference باقٍ
      const issues = await prisma.zatcaDocumentIssue.findMany({ where: { documentId: rejected.id }, orderBy: { icv: "asc" } });
      expect(issues.map((i) => [i.documentUuid, i.source])).toEqual([[rejected.zatcaUuid, "issue"], [done.zatcaUuid, "reissue"]]);
      expect(issues[1].reissueOfIssueId).toBe(issues[0].id);
    }
  });

  it("the migration's backfill registers documents chained before it, keeps their last ZATCA response, and skips duplicates instead of failing", async () => {
    // بيانات سابقة للترحيل (CLAUDE.md القاعدة 2: مسموح صنعها يدوياً) — صفوف بسلسلة محجوزة بلا أي صف في السجلَّين
    const draft = async () => {
      const r = await api("POST", "/sales-invoices", { companyId, customerId: standardCustomerId, date: "2026-07-01T00:00:00.000Z", post: false, lines: [{ accountId: revenueId, quantity: 1, unitPrice: 115 }] });
      expect(r.status, r.text).toBe(201);
      return r.body.id as string;
    };
    const legacy = await draft();
    const dupIcv = await draft();
    const response = { clearanceStatus: "NOT_CLEARED", validationResults: { status: "ERROR", errorMessages: [{ code: "BR-KSA-15", message: "legacy" }] } };
    const chainFields = (icv: number, h: string, at: string) => ({
      status: "pending_submission" as const, zatcaStatus: "rejected" as const, icv, invoiceHash: h, previousInvoiceHash: "pih",
      zatcaSubmittedAt: new Date(at), zatcaResponseRaw: response,
    });
    // نفس ICV مرتين: الأسبق إصداراً يبقى، بصرف النظر عن ترتيب الصفوف في الجدول
    await prisma.salesInvoice.update({ where: { id: dupIcv }, data: chainFields(900_001, "dup-hash", "2026-07-01T11:00:00Z") });
    await prisma.salesInvoice.update({ where: { id: legacy }, data: chainFields(900_001, "legacy-hash", "2026-07-01T10:00:00Z") });

    const sql = readFileSync("prisma/migrations/20261008092218_zatca_document_issues_and_attempts/migration.sql", "utf8");
    const statements = sql.split(/;\s*\n/).map((st) => st.trim()).filter((st) => /^(--[^\n]*\n)*INSERT INTO/.test(st));
    expect(statements).toHaveLength(6);
    // نفس جمل الترحيل حرفياً، مقصورة على مستأجر هذا الاختبار
    for (const st of statements) {
      await prisma.$executeRawUnsafe(st.replace(/WHERE d\./, `WHERE d."tenantId" = '${tenantId}' AND d.`));
    }

    const issue = await prisma.zatcaDocumentIssue.findFirstOrThrow({ where: { documentId: legacy } });
    const legacyRow = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: legacy } });
    expect(issue).toMatchObject({
      id: `bf_inv_${legacy}`, source: "backfill", compression: "none", unsignedXml: null, icv: 900_001, invoiceHash: "legacy-hash",
      subtype: "standard", documentUuid: legacyRow.zatcaUuid, documentNumber: legacyRow.invoiceNumber, tenantId, companyId,
    });
    // ICV مكرَّر في البيانات القديمة: يبقى صف واحد، ولا يسقط الترحيل
    expect(await prisma.zatcaDocumentIssue.count({ where: { documentId: dupIcv } })).toBe(0);
    const attempt = await prisma.zatcaSubmissionAttempt.findFirstOrThrow({ where: { documentId: legacy } });
    expect(attempt).toMatchObject({ source: "backfill", outcome: "rejected", submissionKind: "unknown", signedXml: null, response });
    // الصفوف المسجَّلة سابقاً عبر النظام لا تتكرّر (UUID فريد)
    const registered = await prisma.zatcaDocumentIssue.groupBy({ by: ["documentUuid"], where: { tenantId }, _count: true });
    expect(registered.every((g) => g._count === 1)).toBe(true);

    // وثيقة مستكملة رجعياً يمكن إعادة إصدارها: الإصدار الجديد مرتبط بصف الاستكمال
    zatca.mode = "accept";
    const r = await api("POST", `/sales-invoices/${legacy}/reissue-zatca`);
    expect(r.status, r.text).toBe(200);
    const reissue = await prisma.zatcaDocumentIssue.findFirstOrThrow({ where: { documentId: legacy, source: "reissue" } });
    expect(reissue.reissueOfIssueId).toBe(issue.id);
  });

  it("serves the attempt history and the exact signed XML sent, within the tenant only", async () => {
    const rejected = await rejectedInvoice();
    zatca.mode = "accept";
    await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`);
    const h = await api("GET", `/sales-invoices/${rejected.id}/zatca-history`, undefined, viewerToken);
    expect(h.status, h.text).toBe(200);
    expect(h.body.issues).toHaveLength(2);
    expect(h.body.attempts.map((a: any) => a.outcome)).toEqual(["rejected", "cleared"]);
    expect(JSON.stringify(h.body)).not.toContain("unsignedXml");
    for (const a of h.body.attempts) {
      const res = await fetch(`${baseUrl}/api/sales-invoices/${rejected.id}/zatca-attempts/${a.id}/xml`, { headers: { authorization: `Bearer ${viewerToken}` } });
      expect(res.status).toBe(200);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(sha256(bytes)).toBe(a.signedXmlSha256);
      expect(bytes.toString("utf8")).toContain(`<cbc:UUID>${a.documentUuid}</cbc:UUID>`);
    }
    // مستأجر آخر: لا سجلّ ولا ملف
    const o1 = await api("GET", `/sales-invoices/${rejected.id}/zatca-history`, undefined, otherTenantToken);
    expect(o1.status).toBe(404);
    const o2 = await api("GET", `/sales-invoices/${rejected.id}/zatca-attempts/${h.body.attempts[0].id}/xml`, undefined, otherTenantToken);
    expect(o2.status).toBe(404);
    const o3 = await api("POST", `/sales-invoices/${rejected.id}/reissue-zatca`, undefined, otherTenantToken);
    expect(o3.status).toBe(404);
  });
});
