import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// يثبت أن مسار الاستيراد لا يتصل بزاتكا إطلاقاً — نُموِّه أدنى طبقة فعلية تتصل بالشبكة
// (src/lib/zatca/apiClient.ts، الوحيدة التي تستدعي fetch() نحو خوادم زاتكا الحقيقية) بحيث تُفشِل
// أي استدعاء لها الاختبار فوراً بدل تمريره بصمت. importClearedSalesInvoice.ts لا يستورد من هذا
// الملف أو من chain.ts/postingGate.ts/submission.ts/resubmit.ts إطلاقاً (راجع تعليق الملف نفسه)،
// فهذا التمويه يبقى غير مُستدعى أبداً طوال اختبارات هذا الملف — بما فيها اختبار إشعار الدائن
// الحقيقي (الذي يحاول الاتصال بزاتكا فعلياً، لكن الشركة هنا بلا شهادات ربط حقيقية مُخزَّنة، فيتوقف
// عند loadCompanyZatcaCredentials قبل الوصول لهذا العميل إطلاقاً — راجع القيد الأعلى في المهمة:
// "أي اختبار يجب أن يستخدم زاتكا مُموَّهة وقاعدة بيانات غير إنتاجية").
function failIfCalled(name: string) {
  return vi.fn(() => {
    throw new Error(`ZATCA API client called (${name}) — استيراد مستند مخلَّص يجب ألا يتصل بزاتكا إطلاقاً`);
  });
}
vi.mock("../../lib/zatca/apiClient", () => ({
  requestComplianceCsid: failIfCalled("requestComplianceCsid"),
  requestProductionCsid: failIfCalled("requestProductionCsid"),
  checkInvoiceCompliance: failIfCalled("checkInvoiceCompliance"),
  reportInvoice: failIfCalled("reportInvoice"),
  clearInvoice: failIfCalled("clearInvoice"),
}));

import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import * as apiClient from "../../lib/zatca/apiClient";
import { importClearedSalesInvoice, ImportClearedInvoiceInput } from "./importClearedSalesInvoice";
import { createSalesReturn, postSalesReturn, unpostSalesReturn } from "../salesReturns/salesReturns.service";

/**
 * اختبارات تكامل حقيقية على Postgres فعلي (لا تمويه لقاعدة البيانات) — القيمة الحقيقية هنا (عدم
 * المساس بعدّاد/تجزئة الشركة، رفض التكرار، توازن القيد، وقبول إشعار دائن حقيقي لاحقاً) لا تُختبَر
 * بمعنى حقيقي عبر Prisma مُموَّهة. تُنشئ بياناتها الخاصة ضمن مستأجر معزول وتُنظِّفه بالكامل بعد
 * الانتهاء. راجع constraint المهمة: "غير إنتاجية" — guardAgainstUnsafeIntegrationTestDatabase.
 */
guardAgainstUnsafeIntegrationTestDatabase();

describe("importClearedSalesInvoice (integration)", () => {
  let tenantId: string;
  let companyId: string;
  let revenueAccountId: string;
  let receivableAccountId: string;
  let customerId: string;
  let userId: string;
  let identityId: string;
  let noZatcaCompanyId: string;
  let noZatcaRevenueAccountId: string;
  let noZatcaCustomerId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant ZCI", unlockPin: "hashed" } });
    tenantId = tenant.id;
    // production عمداً (لا not_onboarded) — أخطر سيناريو ممكن لهذا الاختبار: شركة مرتبطة فعلياً
    // بزاتكا حيث محاولة عرضية لحجز سلسلة/إرسال كانت ستكون "طبيعية" المظهر لولا هذا الاختبار.
    const company = await prisma.company.create({ data: { tenantId, name: "Co ZCI", zatcaOnboardingStatus: "production" } });
    companyId = company.id;

    const revenueAccount = await prisma.account.create({
      data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" },
    });
    revenueAccountId = revenueAccount.id;
    await prisma.account.create({
      data: { tenantId, companyId, code: "2101", level: 1, isPosting: true, name: "ضريبة القيمة المضافة - مخرجات", type: "liability" },
    });
    const receivableAccount = await prisma.account.create({
      data: { tenantId, companyId, code: "1121", level: 1, isPosting: true, name: "عميل تجريبي - ذمم", type: "asset" },
    });
    receivableAccountId = receivableAccount.id;

    const customer = await prisma.customer.create({
      data: { tenantId, companyId, name: "شركة الاختبار", customerType: "business", vatNumber: "300000000000003", accountId: receivableAccountId },
    });
    customerId = customer.id;

    // شركة ثانية غير مرتبطة بزاتكا إطلاقاً (not_onboarded) — تُستخدَم حصراً لاختبار "إشعار دائن
    // يُنشأ ويُرحَّل بنجاح" أدناه، لتفادي أي غموض حول شهادات ربط زاتكا الحقيقية (غير المُخزَّنة أصلاً
    // في هذه البيئة): مسار not_onboarded لا يحاول حجز سلسلة زاتكا إطلاقاً بنفسه (raجع
    // reserveZatcaChain في chain.ts)، فالمردود يُنشأ ويُرحَّل مباشرة بحالة posted/not_applicable
    // بلا أي التباس، مع بقاء كل قواعد PR #82 (validateLinkedReturn) نشِطة تماماً بصرف النظر عن حالة
    // الربط بزاتكا.
    const noZatcaCompany = await prisma.company.create({ data: { tenantId, name: "Co ZCI No-ZATCA", zatcaOnboardingStatus: "not_onboarded" } });
    noZatcaCompanyId = noZatcaCompany.id;
    const noZatcaRevenueAccount = await prisma.account.create({
      data: { tenantId, companyId: noZatcaCompanyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" },
    });
    noZatcaRevenueAccountId = noZatcaRevenueAccount.id;
    await prisma.account.create({
      data: { tenantId, companyId: noZatcaCompanyId, code: "2101", level: 1, isPosting: true, name: "ضريبة القيمة المضافة - مخرجات", type: "liability" },
    });
    const noZatcaReceivableAccount = await prisma.account.create({
      data: { tenantId, companyId: noZatcaCompanyId, code: "1121", level: 1, isPosting: true, name: "عميل تجريبي - ذمم", type: "asset" },
    });
    const noZatcaCustomer = await prisma.customer.create({
      data: { tenantId, companyId: noZatcaCompanyId, name: "شركة الاختبار (بلا زاتكا)", customerType: "business", vatNumber: "300000000000004", accountId: noZatcaReceivableAccount.id },
    });
    noZatcaCustomerId = noZatcaCustomer.id;

    const identity = await prisma.identity.create({ data: { email: `zci-${randomUUID()}@example.com`, passwordHash: "x" } });
    identityId = identity.id;
    const user = await prisma.user.create({ data: { identityId, tenantId, name: "مستخدم الاختبار", role: "admin" } });
    userId = user.id;
  }, 30000);

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { tenantId } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.salesReturnLine.deleteMany({ where: { salesReturn: { tenantId } } });
    await prisma.salesReturn.deleteMany({ where: { tenantId } });
    await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { tenantId } } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.identity.deleteMany({ where: { id: identityId } });
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  function baseInput(overrides: Partial<ImportClearedInvoiceInput> = {}): ImportClearedInvoiceInput {
    return {
      companyId,
      customerId,
      invoiceNumber: `INV-ZCI-${randomUUID()}`,
      date: new Date("2026-09-21T09:00:00.000Z"),
      zatcaUuid: randomUUID(),
      icv: Math.floor(Math.random() * 1_000_000) + 1000,
      previousInvoiceHash: "PREV-HASH",
      invoiceHash: "THIS-HASH",
      reason: "استيراد فاتورة خلَّصتها زاتكا فعلياً وضاعت قبل الحفظ — حادثة [zatcaChainGap] 2026-09-21",
      subtotal: 1000,
      vatTotal: 150,
      grandTotal: 1150,
      lines: [
        { accountId: revenueAccountId, quantity: 1, unitPrice: 1000, discountPct: 0, priceIncludesVat: false, vatApplicable: true, subtotal: 1000, vat: 150, total: 1150 },
      ],
      ...overrides,
    };
  }

  async function readCompanyChainState() {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { zatcaNextIcv: true, zatcaLastInvoiceHash: true } });
    return company;
  }

  it("creates a posted, cleared invoice with the caller-supplied ZATCA state, and never touches Company.zatcaNextIcv/zatcaLastInvoiceHash", async () => {
    const before = await readCompanyChainState();

    const input = baseInput();
    const result = await importClearedSalesInvoice(tenantId, userId, input);
    if ("dryRun" in result) throw new Error("expected a real result, got a dry-run preview");

    expect(result.status).toBe("posted");
    expect(result.zatcaStatus).toBe("cleared");
    expect(result.invoiceNumber).toBe(input.invoiceNumber);
    expect(result.zatcaUuid).toBe(input.zatcaUuid);
    expect(result.icv).toBe(input.icv);
    expect(result.previousInvoiceHash).toBe(input.previousInvoiceHash);
    expect(result.invoiceHash).toBe(input.invoiceHash);
    expect(Number(result.grandTotal)).toBeCloseTo(1150, 2);

    const after = await readCompanyChainState();
    expect(after.zatcaNextIcv).toBe(before.zatcaNextIcv);
    expect(after.zatcaLastInvoiceHash).toBe(before.zatcaLastInvoiceHash);

    expect(apiClient.requestComplianceCsid).not.toHaveBeenCalled();
    expect(apiClient.requestProductionCsid).not.toHaveBeenCalled();
    expect(apiClient.checkInvoiceCompliance).not.toHaveBeenCalled();
    expect(apiClient.reportInvoice).not.toHaveBeenCalled();
    expect(apiClient.clearInvoice).not.toHaveBeenCalled();
  });

  it("writes a full, balanced journal entry sourced from the invoice", async () => {
    const input = baseInput();
    const result = await importClearedSalesInvoice(tenantId, userId, input);
    if ("dryRun" in result) throw new Error("expected a real result");

    expect(result.journalEntryId).toBeTruthy();
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: result.journalEntryId! }, include: { lines: true } });
    expect(entry.sourceModule).toBe("sales_invoice");
    expect(entry.sourceId).toBe(result.id);
    expect(entry.status).toBe("posted");

    const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
    expect(totalDebit).toBeCloseTo(1150, 2);
  });

  it("writes an audit-log marker recording the import and its reason", async () => {
    const input = baseInput();
    const result = await importClearedSalesInvoice(tenantId, userId, input);
    if ("dryRun" in result) throw new Error("expected a real result");

    const logs = await prisma.auditLog.findMany({ where: { tenantId, entityType: "SalesInvoice", entityId: result.id } });
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("sales_invoice.imported_from_zatca");
    expect((logs[0].metadata as Record<string, unknown>).reason).toBe(input.reason);
  });

  it("dry-run validates everything and writes nothing", async () => {
    const before = await readCompanyChainState();
    const invoiceCountBefore = await prisma.salesInvoice.count({ where: { tenantId } });

    const input = baseInput();
    const result = await importClearedSalesInvoice(tenantId, userId, input, { dryRun: true });
    expect("dryRun" in result && result.dryRun).toBe(true);

    const invoiceCountAfter = await prisma.salesInvoice.count({ where: { tenantId } });
    expect(invoiceCountAfter).toBe(invoiceCountBefore);
    const after = await readCompanyChainState();
    expect(after).toEqual(before);

    // نفس رقم الفاتورة يبقى غير مُستخدَم فعلياً بعد المعاينة — تأكيد أنها لم تكتب شيئاً.
    const secondAttempt = await importClearedSalesInvoice(tenantId, userId, input);
    if ("dryRun" in secondAttempt) throw new Error("expected a real result");
    expect(secondAttempt.invoiceNumber).toBe(input.invoiceNumber);
  });

  it("rejects an invoice number already used by this company", async () => {
    const first = baseInput();
    await importClearedSalesInvoice(tenantId, userId, first);

    const duplicate = baseInput({ invoiceNumber: first.invoiceNumber, zatcaUuid: randomUUID(), icv: first.icv + 1 });
    await expect(importClearedSalesInvoice(tenantId, userId, duplicate)).rejects.toThrow(/مستخدَم بالفعل/);
  });

  it("rejects a zatcaUuid already used anywhere (sales invoice, return, or debit note)", async () => {
    const first = baseInput();
    await importClearedSalesInvoice(tenantId, userId, first);
    const dup1 = baseInput({ zatcaUuid: first.zatcaUuid, icv: first.icv + 1 });
    await expect(importClearedSalesInvoice(tenantId, userId, dup1)).rejects.toThrow(/مستخدَم بالفعل/);

    // نفس القيمة موجودة في sales_returns فقط (لا sales_invoices) — يجب أن تُرفَض أيضاً، تثبيتاً
    // لأن الفحص يغطي الجداول الثلاثة لا sales_invoices وحدها.
    const returnOnlyUuid = randomUUID();
    await prisma.salesReturn.create({
      data: {
        tenantId, companyId, customerId, returnNumber: `RET-ZCI-${randomUUID()}`, date: new Date("2026-09-21"),
        status: "draft", zatcaStatus: "not_applicable", zatcaUuid: returnOnlyUuid, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5,
      },
    });
    const dup2 = baseInput({ zatcaUuid: returnOnlyUuid });
    await expect(importClearedSalesInvoice(tenantId, userId, dup2)).rejects.toThrow(/مستخدَم بالفعل/);
  });

  it("rejects an icv already used by any invoice, return, or debit note for this company", async () => {
    const first = baseInput();
    await importClearedSalesInvoice(tenantId, userId, first);
    const dup1 = baseInput({ icv: first.icv, zatcaUuid: randomUUID() });
    await expect(importClearedSalesInvoice(tenantId, userId, dup1)).rejects.toThrow(/مستخدَم بالفعل/);

    // نفس icv مستخدَم في sales_returns فقط — يجب أن يُرفَض أيضاً.
    const returnOnlyIcv = Math.floor(Math.random() * 1_000_000) + 2_000_000;
    await prisma.salesReturn.create({
      data: {
        tenantId, companyId, customerId, returnNumber: `RET-ZCI-${randomUUID()}`, date: new Date("2026-09-21"),
        status: "draft", zatcaStatus: "not_applicable", icv: returnOnlyIcv, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5,
      },
    });
    const dup2 = baseInput({ icv: returnOnlyIcv });
    await expect(importClearedSalesInvoice(tenantId, userId, dup2)).rejects.toThrow(/مستخدَم بالفعل/);
  });

  it("rejects when the line amounts don't sum to the supplied header totals", async () => {
    const input = baseInput({ grandTotal: 9999 });
    await expect(importClearedSalesInvoice(tenantId, userId, input)).rejects.toThrow(/لا يطابق/);
  });

  describe("a credit note against the imported invoice", () => {
    // شركة not_onboarded عمداً (راجع تعليق إعدادها أعلاه) — تُبقي هذا الاختبار متمركزاً حصراً على
    // ما طلبته المهمة فعلياً: أن الفاتورة المستوردة تجتاز كل قواعد PR #82 (validateLinkedReturn)
    // عند الإنشاء وعند الترحيل الصريح كليهما، بلا أي التباس حول شهادات زاتكا الحقيقية غير
    // المُخزَّنة في هذه البيئة أصلاً — تلك مسألة منفصلة تماماً عن هدف هذا الاختبار.
    it("can be created and (explicitly) posted, passing every PR #82 rule (posted status, customer match, subtype match, date not before, cumulative cap)", async () => {
      const imported = await importClearedSalesInvoice(tenantId, userId, baseInput({
        companyId: noZatcaCompanyId,
        customerId: noZatcaCustomerId,
        lines: [
          { accountId: noZatcaRevenueAccountId, quantity: 1, unitPrice: 1000, discountPct: 0, priceIncludesVat: false, vatApplicable: true, subtotal: 1000, vat: 150, total: 1150 },
        ],
      }));
      if ("dryRun" in imported) throw new Error("expected a real result");
      expect(imported.status).toBe("posted");

      const created = await createSalesReturn(tenantId, userId, {
        companyId: noZatcaCompanyId,
        customerId: noZatcaCustomerId,
        relatedInvoiceId: imported.id,
        date: new Date("2026-09-22"), // بعد تاريخ الفاتورة المستوردة — يحترم قاعدة "لا يسبق"
        reason: "عكس فاتورة مكرَّرة (حادثة [zatcaChainGap] 2026-09-21)",
        refundMethod: "account",
        lines: [{ originalInvoiceLineId: imported.lines[0].id, accountId: noZatcaRevenueAccountId, quantity: 1 }],
      } as never);
      const createdReturn = created as { id: string; status: string; zatcaStatus: string };
      // not_onboarded لا يحجز سلسلة زاتكا إطلاقاً (راجع reserveZatcaChain في chain.ts) — الإنشاء
      // يُرحِّل مباشرة، بلا أي اتصال بزاتكا على الإطلاق.
      expect(createdReturn.status).toBe("posted");
      expect(createdReturn.zatcaStatus).toBe("not_applicable");

      // فك الترحيل ثم إعادة الترحيل صراحةً عبر postSalesReturn — يعيد تنفيذ نفس تحقّقات PR #82
      // (validateLinkedReturn) من جديد على مسار الترحيل الصريح تحديداً، لا الإنشاء فقط. يتطلّب
      // فك الترحيل رقماً سرياً حقيقياً (bcrypt) للمستأجر — يُضبَط هنا فقط لهذا الاختبار.
      const unlockPin = "482913";
      await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(unlockPin) } });

      await unpostSalesReturn(tenantId, userId, createdReturn.id, unlockPin);
      const reposted = await postSalesReturn(tenantId, userId, createdReturn.id);
      expect((reposted as { status: string }).status).toBe("posted");
      expect((reposted as { zatcaStatus: string }).zatcaStatus).toBe("not_applicable");
    });
  });
});
