import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import path from "path";

/**
 * حادثة INV-00202 (مؤسسة المزارع الحديثة): فاتورة قياسية 33.5 × 5.17 شاملة الضريبة = 173.20 (حالة نصف الهللة 173.195)، حُجزت
 * سلسلتها قبل #148 بالمُنشئ القديم، ثم بعد نشر #149+#150 ضُغط "إعادة إرسال" فأُعيد بناؤها بالمُنشئ المُجمَّد V1 (نفس بايتاتها) ورفضتها
 * زاتكا مجدداً بـBR-CO-15. لوحة سجل زاتكا ظهرت فارغة بلا زر إعادة إصدار.
 *
 * المسار كله عبر HTTP على Postgres فعلي بالتوقيع الحقيقي. المصنوع يدوياً (CLAUDE.md القاعدة 2) هو فقط ما يسبق الترحيلات فعلاً:
 * حالة الصف قبل #150 — بايتاته من المُنتِج القديم نفسه (computeInvoiceLineV1 + buildDocumentXmlV1، المجمَّدان حرفياً)، ثم الاستكمال
 * الرجعي بجمل ترحيل #150 نفسها — وردّ زاتكا (يصل من الخارج).
 */
const zatca = vi.hoisted(() => ({
  mode: "accept" as "accept" | "reject",
  calls: [] as { kind: string; uuid: string; invoiceHash: string; xml: string }[],
}));
vi.mock("../../lib/zatca/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/zatca/apiClient")>();
  const respond = (kind: "clearance" | "reporting") => async (params: { uuid: string; invoiceHash: string; signedInvoiceBase64: string }) => {
    zatca.calls.push({ kind, uuid: params.uuid, invoiceHash: params.invoiceHash, xml: Buffer.from(params.signedInvoiceBase64, "base64").toString("utf8") });
    if (zatca.mode === "reject") {
      return {
        ok: false, status: 400, statusText: "Bad Request", httpError: false,
        data: {
          clearanceStatus: "NOT_CLEARED",
          validationResults: {
            status: "ERROR", infoMessages: [], warningMessages: [],
            errorMessages: [{ type: "ERROR", code: "BR-CO-15", category: "EN_16931", message: "Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).", status: "ERROR" }],
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
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { encryptSecret } from "../../lib/zatca/secretBox";
import { computeDocumentHash } from "../../lib/zatca/hash";
import { buildDocumentXmlV1, computeInvoiceLineV1, mapPersistedLineToZatcaLineV1 } from "../../lib/zatca/xmlBuilderV1";
import { ZATCA_FIRST_INVOICE_PIH } from "../../lib/zatca/types";

guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailPrefix = `zatca-legacy-reissue-${stamp}`;
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let revenueId = "";
let customerId = "";

const keyDir = mkdtempSync(path.join(tmpdir(), "zatca-legacy-reissue-"));
execFileSync("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", path.join(keyDir, "key.pem")]);
execFileSync("openssl", ["req", "-x509", "-key", path.join(keyDir, "key.pem"), "-sha256", "-days", "1", "-subj", "/CN=zatca-test", "-out", path.join(keyDir, "cert.pem")]);
const privateKeyPem = readFileSync(path.join(keyDir, "key.pem"), "utf8");
const certificatePem = readFileSync(path.join(keyDir, "cert.pem"), "utf8");
rmSync(keyDir, { recursive: true, force: true });

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text };
}

const INVOICE_DATE = "2026-10-05T00:00:00.000Z";
const PRE_150_ISSUED_AT = new Date("2026-10-05T09:12:30.000Z");
const LEGACY_REJECTION = {
  clearanceStatus: "NOT_CLEARED",
  validationResults: { status: "ERROR", errorMessages: [{ code: "BR-CO-15", message: "Invoice total amount with VAT (BT-112) = BT-109 + BT-110." }] },
};

/**
 * فاتورة INV-00202 كما كانت قبل #150: 33.5 × 5.17 شاملة، سلسلتها محجوزة بالمُنشئ القديم من الأسطر غير المقرَّبة في الذاكرة
 * (مسار الإنشاء والترحيل المباشر قبل #148 — computeInvoiceLineV1)، ولا صفوف لها في سجلَّي #150 بعد.
 * - pending: مرفوضة pending_submission (الحالة الطبيعية لقياسية رُفضت عند الترحيل).
 * - posted: مُرحَّلة قبل تخليصها (not_submitted — لا شهادة ربط فعّالة وقتها، postingGate.ts) بلا ردّ محفوظ.
 */
async function legacyInvoice(state: "pending" | "posted") {
  if (state === "posted") await prisma.company.update({ where: { id: companyId }, data: { zatcaOnboardingStatus: "not_onboarded" } });
  const created = await api("POST", "/sales-invoices", {
    companyId, customerId, date: INVOICE_DATE, post: state === "posted",
    lines: [{ accountId: revenueId, description: "علف", quantity: 33.5, unitPrice: 5.17, priceIncludesVat: true }],
  });
  if (state === "posted") await prisma.company.update({ where: { id: companyId }, data: { zatcaOnboardingStatus: "production" } });
  expect(created.status, created.text).toBe(201);
  const row = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: created.body.id }, include: { lines: true, customer: true, company: true } });
  expect(Number(row.grandTotal)).toBe(173.2);

  // ما كان يُرسَل قبل #148: الأسطر الخام من computeInvoiceLineV1 ← buildDocumentXmlV1 (المجمَّدان حرفياً من 5145cb5)
  const company = row.company;
  const c = row.customer;
  const line = row.lines[0];
  const raw = computeInvoiceLineV1({ quantity: line.quantity, unitPrice: line.unitPrice, discountPct: line.discountPct, priceIncludesVat: line.priceIncludesVat, taxCategoryCode: line.taxCategoryCode });
  const icv = company.zatcaNextIcv;
  const previousInvoiceHash = company.zatcaLastInvoiceHash || ZATCA_FIRST_INVOICE_PIH;
  const iso = PRE_150_ISSUED_AT.toISOString().replace(/\.\d{3}Z$/, "Z");
  const xml = buildDocumentXmlV1({
    kind: "invoice", subtype: "standard", id: row.invoiceNumber, uuid: row.zatcaUuid, issueDate: iso.slice(0, 10), issueTime: iso.slice(11),
    icv, previousInvoiceHash,
    seller: { vatNumber: company.vatNumber, crNumber: company.crNumber, registrationName: company.name, street: company.addressStreet, buildingNumber: company.addressBuilding, citySubdivision: company.addressDistrict, city: company.addressCity, postalZone: company.addressPostalCode },
    buyer: { vatNumber: c.vatNumber, crNumber: c.crNumber, registrationName: c.name, street: c.street, buildingNumber: c.buildingNo, citySubdivision: c.district, city: c.city, postalZone: c.postalCode },
    lines: [mapPersistedLineToZatcaLineV1({ description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), subtotal: raw.subtotal, vat: raw.vat, taxCategoryCode: line.taxCategoryCode, taxExemptionReason: line.taxExemptionReason, taxExemptionReasonCode: line.taxExemptionReasonCode }, 0)],
  });
  const invoiceHash = computeDocumentHash(xml);
  await prisma.company.update({ where: { id: companyId }, data: { zatcaNextIcv: icv + 1, zatcaLastInvoiceHash: invoiceHash } });
  await prisma.salesInvoice.update({
    where: { id: row.id },
    data: {
      icv, previousInvoiceHash, invoiceHash, zatcaSubmittedAt: PRE_150_ISSUED_AT,
      ...(state === "pending"
        ? { status: "pending_submission", zatcaStatus: "rejected", zatcaResponseRaw: LEGACY_REJECTION }
        : { zatcaStatus: "not_submitted" }),
    },
  });

  // ترحيل #150: الاستكمال الرجعي بجمله نفسها حرفياً، مقصورة على مستأجر هذا الاختبار
  const sql = readFileSync("prisma/migrations/20261008092218_zatca_document_issues_and_attempts/migration.sql", "utf8");
  const statements = sql.split(/;\s*\n/).map((st) => st.trim()).filter((st) => /^(--[^\n]*\n)*INSERT INTO/.test(st));
  expect(statements).toHaveLength(6);
  for (const st of statements) await prisma.$executeRawUnsafe(st.replace(/WHERE d\./, `WHERE d."tenantId" = '${tenantId}' AND d.`));

  return { id: row.id, invoiceNumber: row.invoiceNumber, uuid: row.zatcaUuid, icv, invoiceHash, journalEntryId: row.journalEntryId };
}

describe("INV-00202: pre-#150 standard invoice, V1 retry rejected after #150 → history shown, re-issue allowed (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `مؤسسة المزارع الحديثة ${stamp}`, businessActivity: "retail", name: "المالك", email: `${emailPrefix}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    await prisma.company.update({
      where: { id: companyId },
      data: {
        vatNumber: "310000000000003", crNumber: "1010101010", addressStreet: "طريق الملك فهد", addressBuilding: "1234", addressDistrict: "العليا",
        addressCity: "الرياض", addressPostalCode: "12345", zatcaOnboardingStatus: "production", zatcaEnvironment: "sandbox",
      },
    });
    await prisma.companyZatcaCredential.create({
      data: { companyId, privateKeyEnc: encryptSecret(privateKeyPem), productionCertEnc: encryptSecret(certificatePem), productionSecretEnc: encryptSecret("test-secret") } as never,
    });
    revenueId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    const c = await api("POST", "/customers", {
      companyId, name: "المشتري", customerType: "business", vatNumber: "302043689600003",
      street: "شارع التحلية", buildingNo: "2345", postalCode: "12245", city: "الرياض", district: "السليمانية",
    });
    expect(c.status, c.text).toBe(201);
    customerId = c.body.id;
  }, 120_000);

  beforeEach(() => {
    zatca.calls.length = 0;
    zatca.mode = "accept";
  });

  afterAll(async () => {
    server?.close();
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.companyZatcaCredential.deleteMany({ where: { companyId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  });

  for (const state of ["pending", "posted"] as const) {
    it(`${state === "pending" ? "rejected pending_submission → retry" : "posted before clearance → resend"} at 07:48 rejected again (BR-CO-15): attempt recorded, history and re-issue shown, re-issue clears it`, async () => {
      const legacy = await legacyInvoice(state);
      // الاستكمال الرجعي لـ#150 أنشأ صف الإصدار (والمحاولة إن كان للصف ردّ محفوظ)
      const backfilled = await prisma.zatcaDocumentIssue.findMany({ where: { documentId: legacy.id } });
      expect(backfilled.map((i) => [i.source, i.icv, i.invoiceHash, i.supplyDate])).toEqual([["backfill", legacy.icv, legacy.invoiceHash, null]]);

      // 07:48 — "إعادة إرسال" من القائمة: pending_submission ← retry-zatca-submission، posted ← resend-zatca (InvoicesTab.jsx)
      zatca.mode = "reject";
      const resend = await api("POST", state === "pending" ? `/sales-invoices/${legacy.id}/retry-zatca-submission` : `/sales-invoices/${legacy.id}/resend-zatca`);
      expect(resend.status, resend.text).toBe(200);
      // أُعيد بناؤها بالمُنشئ المُجمَّد: نفس التجزئة المخزَّنة، بلا KSA-5
      expect(zatca.calls).toHaveLength(1);
      expect(zatca.calls[0].invoiceHash).toBe(legacy.invoiceHash);
      expect(zatca.calls[0].xml).not.toContain("cac:Delivery");
      const afterRetry = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: legacy.id } });
      expect([afterRetry.status, afterRetry.zatcaStatus]).toEqual([state === "pending" ? "pending_submission" : "posted", "rejected"]);

      const attempts = await prisma.zatcaSubmissionAttempt.findMany({ where: { documentId: legacy.id }, orderBy: { attemptedAt: "asc" } });
      const expectedAttempts = state === "pending"
        ? [["backfill", "rejected"], ["submission", "rejected"]]
        : [["resubmission", "rejected"]];
      expect(attempts.map((a) => [a.source, a.outcome])).toEqual(expectedAttempts);
      expect(attempts.at(-1)!.reason).toContain("BR-CO-15");
      expect(attempts.at(-1)!.signedXml).not.toBeNull();

      // ما تقرؤه اللوحة: سجل غير فارغ، وإعادة الإصدار مؤهَّلة من الخادم نفسه
      const h = await api("GET", `/sales-invoices/${legacy.id}/zatca-history`);
      expect(h.status, h.text).toBe(200);
      expect(h.body.issues).toHaveLength(1);
      expect(h.body.attempts).toHaveLength(expectedAttempts.length);
      expect(h.body.reissue).toEqual({ eligible: true });
      const { zatcaHistoryView } = await import(path.resolve("frontend/src/wired/sales/zatcaHistoryState.js") as string);
      const view = zatcaHistoryView({ loading: false, error: null, history: h.body, zatcaStatus: afterRetry.zatcaStatus });
      expect(view).toMatchObject({ kind: "data", showReissue: true, reissueBlockedReason: null });

      const journalBefore = await prisma.journalEntry.count({ where: { sourceId: legacy.id } });
      expect(journalBefore).toBe(state === "posted" ? 1 : 0);

      zatca.mode = "accept";
      zatca.calls.length = 0;
      const re = await api("POST", `/sales-invoices/${legacy.id}/reissue-zatca`);
      expect(re.status, re.text).toBe(200);
      const done = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: legacy.id } });
      expect([done.status, done.zatcaStatus]).toEqual(["posted", "cleared"]);
      expect(done.invoiceNumber).toBe(legacy.invoiceNumber);
      expect(done.zatcaUuid).not.toBe(legacy.uuid);
      expect(done.previousInvoiceHash).toBe(legacy.invoiceHash);
      expect(zatca.calls[0].xml).toContain("<cbc:ActualDeliveryDate>2026-10-05</cbc:ActualDeliveryDate>");
      // قيد واحد فقط: للمرحّلة قيدها الأصلي نفسه، وللمعلّقة يُنشأ الآن
      const entries = await prisma.journalEntry.findMany({ where: { sourceId: legacy.id } });
      expect(entries).toHaveLength(1);
      if (state === "posted") expect(entries[0].id).toBe(legacy.journalEntryId);
      expect(done.journalEntryId).toBe(entries[0].id);
      const issues = await prisma.zatcaDocumentIssue.findMany({ where: { documentId: legacy.id }, orderBy: { icv: "asc" } });
      expect(issues.map((i) => i.source)).toEqual(["backfill", "reissue"]);
      expect(issues[1].reissueOfIssueId).toBe(issues[0].id);

      const after = await api("GET", `/sales-invoices/${legacy.id}/zatca-history`);
      expect(after.body.reissue.eligible).toBe(false);
      expect(after.body.attempts.at(-1).outcome).toBe("cleared");
    }, 120_000);
  }

  it("a cleared invoice is not eligible, and the history says why", async () => {
    zatca.mode = "accept";
    const r = await api("POST", "/sales-invoices", {
      companyId, customerId, date: INVOICE_DATE, post: true,
      lines: [{ accountId: revenueId, description: "علف", quantity: 1, unitPrice: 115, priceIncludesVat: true }],
    });
    expect(r.status, r.text).toBe(201);
    const h = await api("GET", `/sales-invoices/${r.body.id}/zatca-history`);
    expect(h.body.reissue.eligible).toBe(false);
    expect(h.body.reissue.reason).toMatch(/رفضته زاتكا/);
    const denied = await api("POST", `/sales-invoices/${r.body.id}/reissue-zatca`);
    expect(denied.status).toBe(400);
  }, 120_000);
});
