import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import path from "path";

/**
 * سلسلة ICV/PIH تحت ترحيل متزامن — على Postgres فعلي، عبر HTTP، بالبناء والتوقيع الحقيقيَّين. الدليل الفني لزاتكا (القسم 4.3):
 * PIH لكل مستند = تجزئة آخر مستند وُلِّد في الشركة. قبل الإصلاح كانت PIH تُقرأ من صف الشركة قبل المعاملة، فمستندان متزامنان
 * يأخذان ICV متتاليين بنفس PIH. المُموَّه هو ردّ زاتكا وحده (يصل من الخارج — CLAUDE.md القاعدة 2). لا اتصال بزاتكا.
 */
vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  const ok = (kind: "clearance" | "reporting") => async (params: { signedInvoiceBase64: string }) => ({
    ok: true, status: 200,
    data: kind === "clearance"
      ? { clearanceStatus: "CLEARED", clearedInvoice: params.signedInvoiceBase64, validationResults: { status: "PASS", infoMessages: [], warningMessages: [], errorMessages: [] } }
      : { reportingStatus: "REPORTED", validationResults: { status: "PASS", infoMessages: [], warningMessages: [], errorMessages: [] } },
  });
  const never = (name: string) => () => { throw new Error(`${name} must not be called`); };
  return {
    ...actual,
    clearInvoice: vi.fn(ok("clearance")),
    reportInvoice: vi.fn(ok("reporting")),
    checkInvoiceCompliance: vi.fn(never("checkInvoiceCompliance")),
    requestComplianceCsid: vi.fn(never("requestComplianceCsid")),
    requestProductionCsid: vi.fn(never("requestProductionCsid")),
  };
});

import { prisma } from "../prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../../modules/auth/auth.service";
import { encryptSecret } from "./secretBox";
import { ZATCA_FIRST_INVOICE_PIH } from "./types";

guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailPrefix = `zatca-chain-race-${stamp}`;
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let revenueId = "";
let standardCustomerId = "";
let simplifiedCustomerId = "";

const keyDir = mkdtempSync(path.join(tmpdir(), "zatca-chain-race-"));
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

const invoiceBody = (customerId: string, post = true) => ({
  companyId, customerId, date: "2026-10-01T00:00:00.000Z", post,
  lines: [{ accountId: revenueId, description: "خدمة", quantity: 2, unitPrice: 57.5, priceIncludesVat: true }],
});

/** كل مستند حُجزت له سلسلة في الشركة، من الجداول الثلاثة، مرتَّباً بـICV */
async function chainOf(company: string) {
  const pick = { icv: true, previousInvoiceHash: true, invoiceHash: true } as const;
  const where = { companyId: company, icv: { not: null } };
  const rows = [
    ...(await prisma.salesInvoice.findMany({ where, select: { ...pick, invoiceNumber: true } })).map((r) => ({ ...r, doc: r.invoiceNumber })),
    ...(await prisma.salesReturn.findMany({ where, select: { ...pick, returnNumber: true } })).map((r) => ({ ...r, doc: r.returnNumber })),
    ...(await prisma.salesDebitNote.findMany({ where, select: { ...pick, debitNoteNumber: true } })).map((r) => ({ ...r, doc: r.debitNoteNumber })),
  ];
  return rows.sort((a, b) => a.icv! - b.icv!);
}

function expectUnbrokenChain(chain: Awaited<ReturnType<typeof chainOf>>, firstIcv: number, firstPih: string) {
  expect(chain.map((c) => c.icv)).toEqual(chain.map((_, i) => firstIcv + i)); // بلا فجوات ولا تكرار
  chain.forEach((c, i) => {
    const expected = i === 0 ? firstPih : chain[i - 1].invoiceHash;
    expect(c.previousInvoiceHash, `ICV ${c.icv} (${c.doc}) PIH`).toBe(expected);
  });
  expect(new Set(chain.map((c) => c.invoiceHash)).size).toBe(chain.length);
}

describe("ZATCA ICV/PIH chain under concurrent postings (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `سلسلة متزامنة ${stamp}`, businessActivity: "retail", name: "المالك", email: `${emailPrefix}@example.com`, password: "Str0ng-Pass!" });
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
    const std = await api("POST", "/customers", {
      companyId, name: "شركة المشتري", customerType: "business", vatNumber: "300000000000003",
      street: "شارع الأمير", buildingNo: "4321", postalCode: "54321", city: "جدة", district: "الروضة",
    });
    expect(std.status, std.text).toBe(201);
    standardCustomerId = std.body.id;
    const simp = await api("POST", "/customers", { companyId, name: "فرد", customerType: "individual" });
    expect(simp.status, simp.text).toBe(201);
    simplifiedCustomerId = simp.body.id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.salesReturn.deleteMany({ where: { tenantId } });
    await prisma.salesDebitNote.deleteMany({ where: { tenantId } });
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

  it("N parallel postings of every kind in one company: gapless ICVs, and each PIH is the previous document's hash", async () => {
    // مرجع للإشعارات، ومسودّات تُرحَّل بالتوازي (مسار ترحيل المسودة)
    const original = await api("POST", "/sales-invoices", invoiceBody(standardCustomerId));
    expect(original.status, original.text).toBe(201);
    const originalLine = (await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: original.body.id } })).id;
    const drafts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = await api("POST", "/sales-invoices", invoiceBody(i % 2 ? standardCustomerId : simplifiedCustomerId, false));
      expect(d.status, d.text).toBe(201);
      drafts.push(d.body.id);
    }
    const creditNote = () => api("POST", "/sales-returns", {
      companyId, customerId: standardCustomerId, relatedInvoiceId: original.body.id, date: "2026-10-02T00:00:00.000Z", reason: "مرتجع جزئي",
      lines: [{ originalInvoiceLineId: originalLine, accountId: revenueId, quantity: 0.1, unitPrice: 57.5 }],
    });
    const debitNote = () => api("POST", "/sales-debit-notes", {
      companyId, customerId: standardCustomerId, relatedInvoiceId: original.body.id, date: "2026-10-02T00:00:00.000Z", reason: "فرق سعر",
      lines: [{ accountId: revenueId, description: "فرق", quantity: 1, unitPrice: 11.5 }],
    });
    // أول إشعار من كل نوع يُنشئ صف إعدادات ترقيمه (reserveDocumentNumber) — يُنشأ قبل الدفعة المتزامنة: سباق إنشاء ذلك الصف
    // أول مرة عطل مستقل عن السلسلة (يُرفَض الطلب كله ويتراجع، بلا أثر على ICV/PIH)، وليس موضوع هذا الاختبار
    for (const first of [creditNote, debitNote]) {
      const r = await first();
      expect(r.status, r.text).toBe(201);
    }
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const N = 6;
    const requests = [
      ...Array.from({ length: N }, (_, i) => () => api("POST", "/sales-invoices", invoiceBody(i % 2 ? standardCustomerId : simplifiedCustomerId))),
      ...drafts.map((id) => () => api("POST", `/sales-invoices/${id}/post`)),
      ...Array.from({ length: 3 }, () => creditNote),
      ...Array.from({ length: 3 }, () => debitNote),
    ];
    const results = await Promise.all(requests.map((send) => send()));
    for (const r of results) expect([200, 201], r.text).toContain(r.status);

    const chain = (await chainOf(companyId)).filter((c) => c.icv! >= before.zatcaNextIcv);
    expect(chain).toHaveLength(requests.length);
    expectUnbrokenChain(chain, before.zatcaNextIcv, before.zatcaLastInvoiceHash || ZATCA_FIRST_INVOICE_PIH);
    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.zatcaNextIcv).toBe(before.zatcaNextIcv + requests.length);
    expect(after.zatcaLastInvoiceHash).toBe(chain.at(-1)!.invoiceHash);
  }, 120_000);

  it("holds over repeated bursts (the whole company chain from ICV 1)", async () => {
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => api("POST", "/sales-invoices", invoiceBody(i % 3 ? simplifiedCustomerId : standardCustomerId))));
      for (const r of results) expect(r.status, r.text).toBe(201);
    }
    const chain = await chainOf(companyId);
    expectUnbrokenChain(chain, 1, ZATCA_FIRST_INVOICE_PIH);
  }, 120_000);
});
