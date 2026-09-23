import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createSalesReturn, updateSalesReturn, postSalesReturn } from "./salesReturns.service";

/**
 * اختبارات تكامل حقيقية على Postgres فعلي (لا تمويه) لكل قيود إشعار الدائن المرتبط بفاتورة أصلية —
 * تثبت أن updateSalesReturn وpostSalesReturn كليهما يتحققان من نفس القيود الخمسة بالضبط التي
 * تتحقق منها createSalesReturn، لا فقط عند الإنشاء:
 *   1) سقف الاستخدام التراكمي (الكمية والصافي) عبر كل إشعارات الدائن الأخرى على نفس الفاتورة،
 *      باستثناء المسودة نفسها عند إعادة الفحص.
 *   2) الفاتورة الأصلية وسبب الإصدار إلزاميان لشركة مرتبطة بزاتكا.
 *   3) الفاتورة الأصلية يجب أن تكون مرحّلة فعلياً.
 *   4) عميل/فاتورة الإشعار لا يجوز تغييرهما بعد الإنشاء، ونوع الإشعار (قياسي/مبسّط) يجب أن يطابق
 *      نوع الفاتورة الأصلية.
 *   5) تاريخ الإشعار يجب ألا يسبق تاريخ الفاتورة الأصلية.
 * كل اختبار: "مسودة صالحة" (عبر إدراج مباشر يحاكي مسار إنشاء→ترحيل→فك ترحيل الحقيقي) → تعديل يخالف
 * القاعدة (update يرفض) → فرض نفس المخالفة مباشرة على الصف المخزَّن (تجاوز الحماية عمداً، يحاكي صفاً
 * فاسداً من أي مصدر آخر) → ترحيل (post يرفض أيضاً)، إثباتاً لأن كليهما يعيد التحقق باستقلالية.
 */
guardAgainstUnsafeIntegrationTestDatabase();

describe("credit note linkage rules — enforced on update AND post (integration)", () => {
  let tenantId: string;
  let companyId: string;
  let revenueAccountId: string;
  let customerAId: string;
  let customerBId: string;
  let returnCounter = 0;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant CNR", unlockPin: "hashed" } });
    tenantId = tenant.id;
    const company = await prisma.company.create({ data: { tenantId, name: "Co CNR", zatcaOnboardingStatus: "production" } });
    companyId = company.id;

    const revenueAccount = await prisma.account.create({
      data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" },
    });
    revenueAccountId = revenueAccount.id;
    // مطلوب اسماً فقط (getAccountIdByName) — لا إشارة مباشرة إليه لاحقاً؛ postSalesReturn يحلّه
    // ضمناً عند بناء قيد المردود المحاسبي.
    await prisma.account.create({
      data: { tenantId, companyId, code: "2101", level: 1, isPosting: true, name: "ضريبة القيمة المضافة - مخرجات", type: "liability" },
    });
    const creditAccount = await prisma.account.create({
      data: { tenantId, companyId, code: "1121", level: 1, isPosting: true, name: "عميل تجريبي - ذمم", type: "asset" },
    });

    const customerA = await prisma.customer.create({
      data: { tenantId, companyId, name: "شركة الاختبار أ", customerType: "business", vatNumber: "300000000000003", accountId: creditAccount.id },
    });
    customerAId = customerA.id;
    const customerB = await prisma.customer.create({
      data: { tenantId, companyId, name: "شركة الاختبار ب", customerType: "business", vatNumber: "300000000000004", accountId: creditAccount.id },
    });
    customerBId = customerB.id;
  }, 30000);

  afterAll(async () => {
    // اختبار "نفس اليوم السعودي" أدناه يُنجز ترحيلاً محلياً حقيقياً (createSalesReturn/
    // postSalesReturn ناجحين فعلاً، لا مرفوضين) — ينشئ قيوداً محاسبية حقيقية تُشير لحسابات الشركة،
    // فيجب حذفها أولاً قبل حذف الحسابات نفسها (قيد مفتاح أجنبي على accountId).
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { tenantId } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.salesReturnLine.deleteMany({ where: { salesReturn: { tenantId } } });
    await prisma.salesReturn.deleteMany({ where: { tenantId } });
    await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { tenantId } } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  async function makeInvoice(opts: { invoiceNumber: string; customerId: string; quantity: number; date: Date; invoiceType?: "standard" | "simplified" }) {
    const subtotal = opts.quantity * 100;
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const grandTotal = subtotal + vat;
    return prisma.salesInvoice.create({
      data: {
        tenantId, companyId, customerId: opts.customerId, invoiceNumber: opts.invoiceNumber, date: opts.date,
        invoiceType: opts.invoiceType ?? "standard", status: "posted", subtotal, vatTotal: vat, grandTotal,
        lines: { create: [{ accountId: revenueAccountId, quantity: opts.quantity, unitPrice: 100, subtotal, vat, total: grandTotal }] },
      },
      include: { lines: true },
    });
  }

  async function makeDraftReturn(opts: { invoiceId: string; originalLineId: string; customerId: string; quantity: number; date: Date; reason?: string | null }) {
    const subtotal = opts.quantity * 100;
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const grandTotal = subtotal + vat;
    returnCounter += 1;
    return prisma.salesReturn.create({
      data: {
        tenantId, companyId, customerId: opts.customerId, returnNumber: `RET-CNR-${returnCounter}`,
        relatedInvoiceId: opts.invoiceId, date: opts.date, reason: opts.reason ?? "بضاعة تالفة", refundMethod: "account",
        status: "draft", zatcaStatus: "not_applicable", subtotal, vatTotal: vat, grandTotal,
        lines: { create: [{ originalInvoiceLineId: opts.originalLineId, accountId: revenueAccountId, quantity: opts.quantity, unitPrice: 100, subtotal, vat, total: grandTotal }] },
      },
      include: { lines: true },
    });
  }

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      companyId, customerId: customerAId, date: new Date("2026-01-10"), reason: "بضاعة تالفة",
      refundMethod: "account" as const, lines: [],
      ...overrides,
    } as never;
  }

  describe("rule 1 — cumulative per-line cap (quantity + net) across other credit notes on the same invoice", () => {
    it("rejects an update/post that would exceed the cap once combined with an already-posted credit note, excluding the draft's own prior usage", async () => {
      const invoice = await makeInvoice({ invoiceNumber: "INV-CNR-CAP-1", customerId: customerAId, quantity: 10, date: new Date("2026-01-01") });
      const lineId = invoice.lines[0].id;

      const otherPosted = await makeDraftReturn({ invoiceId: invoice.id, originalLineId: lineId, customerId: customerAId, quantity: 8, date: new Date("2026-01-05") });
      await prisma.salesReturn.update({ where: { id: otherPosted.id }, data: { status: "posted" } });

      const draft = await makeDraftReturn({ invoiceId: invoice.id, originalLineId: lineId, customerId: customerAId, quantity: 1, date: new Date("2026-01-06") });

      await expect(
        updateSalesReturn(tenantId, draft.id, baseInput({
          relatedInvoiceId: invoice.id, date: new Date("2026-01-06"),
          lines: [{ originalInvoiceLineId: lineId, accountId: revenueAccountId, quantity: 3 }],
        })),
      ).rejects.toThrow(/تجاوز/);

      // فرض نفس المخالفة على الصف المخزَّن مباشرة (تجاوز الحماية عمداً) — يثبت أن postSalesReturn
      // يعيد نفس الفحص باستقلالية عن أي حالة كانت عليها المسودة وقت آخر تعديل ناجح.
      await prisma.salesReturnLine.updateMany({ where: { returnId: draft.id }, data: { quantity: 3, subtotal: 300, vat: 45, total: 345 } });
      await prisma.salesReturn.update({ where: { id: draft.id }, data: { subtotal: 300, vatTotal: 45, grandTotal: 345 } });

      await expect(postSalesReturn(tenantId, "user-1", draft.id)).rejects.toThrow(/تجاوز/);
    });
  });

  describe("rule 2 — original invoice and reason mandatory for a ZATCA-onboarded company", () => {
    it("rejects removing the reason while still linked to an original invoice", async () => {
      const invoice = await makeInvoice({ invoiceNumber: "INV-CNR-R2-1", customerId: customerAId, quantity: 2, date: new Date("2026-01-01") });
      const lineId = invoice.lines[0].id;
      const draft = await makeDraftReturn({ invoiceId: invoice.id, originalLineId: lineId, customerId: customerAId, quantity: 1, date: new Date("2026-01-05") });

      await expect(
        updateSalesReturn(tenantId, draft.id, baseInput({
          relatedInvoiceId: invoice.id, date: new Date("2026-01-05"), reason: "",
          lines: [{ originalInvoiceLineId: lineId, accountId: revenueAccountId, quantity: 1 }],
        })),
      ).rejects.toThrow(/إلزاميان/);

      await prisma.salesReturn.update({ where: { id: draft.id }, data: { reason: null } });
      await expect(postSalesReturn(tenantId, "user-1", draft.id)).rejects.toThrow(/إلزاميان/);
    });
  });

  describe("rule 3 — the original invoice must be posted", () => {
    it("rejects once the linked original invoice is no longer posted", async () => {
      const invoice = await makeInvoice({ invoiceNumber: "INV-CNR-R3-1", customerId: customerAId, quantity: 2, date: new Date("2026-01-01") });
      const lineId = invoice.lines[0].id;
      const draft = await makeDraftReturn({ invoiceId: invoice.id, originalLineId: lineId, customerId: customerAId, quantity: 1, date: new Date("2026-01-05") });

      // الفاتورة الأصلية تُفك ترحيلها لاحقاً (محاكاة) — تصبح مسودة، لا مرحّلة.
      await prisma.salesInvoice.update({ where: { id: invoice.id }, data: { status: "draft" } });

      await expect(
        updateSalesReturn(tenantId, draft.id, baseInput({
          relatedInvoiceId: invoice.id, date: new Date("2026-01-05"),
          lines: [{ originalInvoiceLineId: lineId, accountId: revenueAccountId, quantity: 1 }],
        })),
      ).rejects.toThrow();

      await expect(postSalesReturn(tenantId, "user-1", draft.id)).rejects.toThrow();
    });
  });

  describe("rule 4 — customer and original invoice link are immutable, and the credit note's subtype must match the original invoice's type", () => {
    it("rejects re-pointing an existing draft to a different customer or a different original invoice", async () => {
      const invoiceA1 = await makeInvoice({ invoiceNumber: "INV-CNR-R4A-1", customerId: customerAId, quantity: 2, date: new Date("2026-01-01") });
      const invoiceA2 = await makeInvoice({ invoiceNumber: "INV-CNR-R4A-2", customerId: customerAId, quantity: 2, date: new Date("2026-01-01") });
      const draft = await makeDraftReturn({ invoiceId: invoiceA1.id, originalLineId: invoiceA1.lines[0].id, customerId: customerAId, quantity: 1, date: new Date("2026-01-05") });

      await expect(
        updateSalesReturn(tenantId, draft.id, baseInput({
          relatedInvoiceId: invoiceA2.id, date: new Date("2026-01-05"),
          lines: [{ originalInvoiceLineId: invoiceA2.lines[0].id, accountId: revenueAccountId, quantity: 1 }],
        })),
      ).rejects.toThrow(/تغيير الفاتورة الأصلية/);

      await expect(
        updateSalesReturn(tenantId, draft.id, baseInput({
          customerId: customerBId, relatedInvoiceId: invoiceA1.id, date: new Date("2026-01-05"),
          lines: [{ originalInvoiceLineId: invoiceA1.lines[0].id, accountId: revenueAccountId, quantity: 1 }],
        })),
      ).rejects.toThrow(/تغيير عميل/);

      // فرض إعادة ربط الصف المخزَّن بعميل مختلف تماماً مباشرة (تجاوز حماية update عمداً) — post
      // يجب أن يرفضه أيضاً باستقلالية (الفاتورة الأصلية لم تعد تخص عميل الإشعار المخزَّن).
      await prisma.salesReturn.update({ where: { id: draft.id }, data: { customerId: customerBId } });
      await expect(postSalesReturn(tenantId, "user-1", draft.id)).rejects.toThrow();
    });

    it("rejects when the customer's derived subtype (standard/simplified) no longer matches the original invoice's type", async () => {
      const customerC = await prisma.customer.create({
        data: { tenantId, companyId, name: "شركة الاختبار ج", customerType: "business", vatNumber: "300000000000005", accountId: (await prisma.customer.findFirstOrThrow({ where: { id: customerAId } })).accountId },
      });
      const invoice = await makeInvoice({ invoiceNumber: "INV-CNR-R4B-1", customerId: customerC.id, quantity: 2, date: new Date("2026-01-01"), invoiceType: "standard" });
      const lineId = invoice.lines[0].id;
      const draft = await makeDraftReturn({ invoiceId: invoice.id, originalLineId: lineId, customerId: customerC.id, quantity: 1, date: new Date("2026-01-05") });

      // بيانات العميل تتغيّر لاحقاً (يفقد رقمه الضريبي) — الإشعار الآن سيُشتق له نوع "مبسّط" بينما
      // الفاتورة الأصلية "قياسية".
      await prisma.customer.update({ where: { id: customerC.id }, data: { customerType: "individual", vatNumber: null } });

      await expect(
        updateSalesReturn(tenantId, draft.id, {
          companyId, customerId: customerC.id, relatedInvoiceId: invoice.id, date: new Date("2026-01-05"), reason: "بضاعة تالفة", refundMethod: "account",
          lines: [{ originalInvoiceLineId: lineId, accountId: revenueAccountId, quantity: 1 }],
        } as never),
      ).rejects.toThrow(/يطابق/);

      await expect(postSalesReturn(tenantId, "user-1", draft.id)).rejects.toThrow(/يطابق/);
    });
  });

  describe("rule 5 — the credit note's date must not be earlier than the original invoice's date", () => {
    it("rejects a credit note date before the original invoice's date", async () => {
      const invoice = await makeInvoice({ invoiceNumber: "INV-CNR-R5-1", customerId: customerAId, quantity: 2, date: new Date("2026-02-01") });
      const lineId = invoice.lines[0].id;
      const draft = await makeDraftReturn({ invoiceId: invoice.id, originalLineId: lineId, customerId: customerAId, quantity: 1, date: new Date("2026-02-05") });

      await expect(
        updateSalesReturn(tenantId, draft.id, baseInput({
          relatedInvoiceId: invoice.id, date: new Date("2026-01-15"),
          lines: [{ originalInvoiceLineId: lineId, accountId: revenueAccountId, quantity: 1 }],
        })),
      ).rejects.toThrow(/يسبق/);

      await prisma.salesReturn.update({ where: { id: draft.id }, data: { date: new Date("2026-01-15") } });
      await expect(postSalesReturn(tenantId, "user-1", draft.id)).rejects.toThrow(/يسبق/);
    });

    // الفاتورة عند الساعة 23:30 بتوقيت الرياض (20:30 UTC) من 2026-01-15 — نفس رقم الساعة المستخدَم
    // في اختبارات dateTo لقائمة البحث (راجع salesReturnsSearch.integration.test.ts) لتغطية نفس
    // حافة اليوم السعودي بالضبط. إشعار الدائن بنفس اليوم السعودي لكن بتوقيت UTC "أبكر" رقمياً
    // (00:00 UTC لنفس التاريخ، أي 03:00 صباحاً بتوقيت الرياض من نفس اليوم) يجب أن يُقبَل — مقارنة
    // الطابع الزمني الخام (Date.getTime()) كانت سترفضه خطأً رغم كونه نفس اليوم السعودي فعلياً.
    it("accepts a credit note on the same Saudi calendar day as the original invoice on create, update, and post, regardless of the time-of-day stored on either date", async () => {
      const invoiceDate = new Date("2026-01-15T20:30:00.000Z");
      const sameDayEarlierUtc = new Date("2026-01-15T00:00:00.000Z");

      // 1) الإنشاء (createSalesReturn) — يستدعي نفس validateLinkedReturn المشترَكة.
      const invoiceForCreate = await makeInvoice({ invoiceNumber: "INV-CNR-R5-SAMEDAY-CREATE", customerId: customerAId, quantity: 5, date: invoiceDate });
      const created = await createSalesReturn(tenantId, "user-1", {
        companyId, customerId: customerAId, relatedInvoiceId: invoiceForCreate.id, date: sameDayEarlierUtc,
        reason: "بضاعة تالفة", refundMethod: "account",
        lines: [{ originalInvoiceLineId: invoiceForCreate.lines[0].id, accountId: revenueAccountId, quantity: 1 }],
      } as never);
      expect((created as { id: string }).id).toBeTruthy();

      // 2) التعديل (updateSalesReturn) — مسودة صالحة بتاريخ آخر تُعدَّل لتحمل نفس يوم الفاتورة
      // السعودي بتوقيت UTC أبكر رقمياً.
      const invoiceForUpdate = await makeInvoice({ invoiceNumber: "INV-CNR-R5-SAMEDAY-UPDATE", customerId: customerAId, quantity: 5, date: invoiceDate });
      const draftForUpdate = await makeDraftReturn({
        invoiceId: invoiceForUpdate.id, originalLineId: invoiceForUpdate.lines[0].id, customerId: customerAId, quantity: 1, date: new Date("2026-02-01"),
      });
      await expect(
        updateSalesReturn(tenantId, draftForUpdate.id, baseInput({
          relatedInvoiceId: invoiceForUpdate.id, date: sameDayEarlierUtc,
          lines: [{ originalInvoiceLineId: invoiceForUpdate.lines[0].id, accountId: revenueAccountId, quantity: 1 }],
        })),
      ).resolves.toBeTruthy();

      // 3) الترحيل (postSalesReturn) — مسودة مخزَّنة بالفعل بنفس يوم الفاتورة السعودي بتوقيت UTC
      // أبكر رقمياً من توقيت الفاتورة نفسه.
      const invoiceForPost = await makeInvoice({ invoiceNumber: "INV-CNR-R5-SAMEDAY-POST", customerId: customerAId, quantity: 5, date: invoiceDate });
      const draftForPost = await makeDraftReturn({
        invoiceId: invoiceForPost.id, originalLineId: invoiceForPost.lines[0].id, customerId: customerAId, quantity: 1, date: sameDayEarlierUtc,
      });
      await expect(postSalesReturn(tenantId, "user-1", draftForPost.id)).resolves.toBeTruthy();
    });
  });
});
