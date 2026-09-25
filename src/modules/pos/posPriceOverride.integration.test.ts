import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createPosSale } from "./pos.service";
import { hashPassword } from "../../lib/password";

/**
 * اختبار تكامل حقيقي على Postgres فعلي لميزة تعديل سعر الوحدة في نقطة البيع (posPriceOverride):
 * صنف بسعر مسجَّل، مستخدم بلا صلاحية يحاول بيعه بسعر مختلف (يُرفَض)، ثم نفس المستخدم بعد منحه
 * صلاحية "sales.posPriceOverride" عبر منصب حقيقي (نفس آلية posDeferredSale تماماً) ينجح، ويُكتَب
 * سجل تدقيق واحد بالضبط بالسعرين الصحيحين، والفاتورة نفسها تحمل السعر الجديد فعلياً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

describe("POS unit price override (integration)", () => {
  let tenantId: string;
  let companyId: string;
  let revenueAccountId: string;
  let itemId: string;
  let userId: string;
  let positionId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant POS Price", unlockPin: await hashPassword("482913") } });
    tenantId = tenant.id;
    const company = await prisma.company.create({ data: { tenantId, name: "Co POS Price" } });
    companyId = company.id;

    const revenueAccount = await prisma.account.create({
      data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" },
    });
    revenueAccountId = revenueAccount.id;
    // "cash" في createReceipt يُحلّ بالاسم حرفياً (getAccountIdByName، receipts.service.ts) — لا
    // بأي معرّف صريح، فالاسم هنا يجب أن يطابق CREDIT_ACCOUNT_NAME.cash بالضبط.
    await prisma.account.create({
      data: { tenantId, companyId, code: "1001", level: 1, isPosting: true, name: "النقدية بالصندوق", type: "asset", isBankOrCash: true },
    });
    // ضريبة القيمة المضافة تُحلّ بالاسم (getAccountIdByName) — لازمة لأي فاتورة عليها ضريبة فعلية.
    await prisma.account.create({
      data: { tenantId, companyId, code: "2101", level: 1, isPosting: true, name: "ضريبة القيمة المضافة على المخرجات", type: "liability" },
    });
    // العميل النقدي أدناه بلا accountId مستقل، فيُحلّ الحساب المدين بالاسم عبر resolvePartyAccountId
    // (getAccountIdByName مع "ذمم مدينة" — أول مرشّح في سلسلة الأسماء البديلة، لا حاجة لبقية السلسلة).
    await prisma.account.create({
      data: { tenantId, companyId, code: "1121", level: 1, isPosting: true, name: "ذمم مدينة", type: "asset" },
    });

    await prisma.customer.create({
      data: { tenantId, companyId, name: "عميل نقدي", customerType: "individual" },
    });

    await prisma.warehouse.create({ data: { tenantId, companyId, name: "المستودع الرئيسي", isDefault: true } });

    const item = await prisma.item.create({
      data: {
        tenantId, companyId, code: "SVC-1", name: "خدمة اختبار", type: "service",
        salePrice: 100, vatApplicable: true, revenueAccountId: revenueAccount.id,
      },
    });
    itemId = item.id;

    const identity = await prisma.identity.create({ data: { email: "pos-price-tester@example.com", passwordHash: "x" } });
    const user = await prisma.user.create({ data: { tenantId, identityId: identity.id, name: "كاشير الاختبار", role: "accountant" } });
    userId = user.id;

    const position = await prisma.position.create({ data: { tenantId, name: "كاشير بلا صلاحية سعر" } });
    positionId = position.id;
    await prisma.user.update({ where: { id: userId }, data: { positionId } });
  }, 30000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { tenantId } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.receiptAllocation.deleteMany({ where: { receipt: { tenantId } } });
    await prisma.receipt.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { tenantId } } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.item.deleteMany({ where: { tenantId } });
    await prisma.warehouse.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    const testUsers = await prisma.user.findMany({ where: { tenantId }, select: { identityId: true } });
    await prisma.user.deleteMany({ where: { tenantId } });
    // Identity منفصل تماماً عن User (Identity → User هو اتجاه الـcascade، لا العكس) — حذف المستخدم
    // لا يحذف Identity المرتبط تلقائياً، فيجب حذفه صراحةً هنا وإلا يبقى بريده يتيماً يمنع أي اختبار
    // لاحق من إعادة استخدام نفس العنوان (قيد فريد على email).
    await prisma.identity.deleteMany({ where: { id: { in: testUsers.map((u) => u.identityId) } } });
    await prisma.position.deleteMany({ where: { tenantId } });
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  function baseLine(unitPrice: number) {
    return { accountId: revenueAccountId, itemId, quantity: 1, unitPrice, priceIncludesVat: true, vatApplicable: true };
  }

  it("rejects a price override attempt when the user's position lacks posPriceOverride", async () => {
    await expect(
      createPosSale(tenantId, userId, "accountant", {
        companyId,
        date: new Date("2026-01-10"),
        lines: [baseLine(120)], // 100 مسجَّل، 120 مُدخَل — تعديل فعلي
        payments: [{ method: "cash", amount: 138 }],
      }),
    ).rejects.toThrow(/صلاحية تعديل سعر الوحدة/);

    const invoiceCount = await prisma.salesInvoice.count({ where: { tenantId } });
    expect(invoiceCount).toBe(0); // رُفض قبل أي إنشاء فعلي — لا فاتورة يتيمة
  });

  it("does not reject a sale at the item's own registered price (no override at all)", async () => {
    const { invoice } = await createPosSale(tenantId, userId, "accountant", {
      companyId,
      date: new Date("2026-01-10"),
      lines: [baseLine(100)],
      payments: [{ method: "cash", amount: 100 }],
    });
    expect(invoice.status).toBe("posted");
    const overrideLogs = await prisma.auditLog.count({ where: { tenantId, action: "pos_sale.price_override" } });
    expect(overrideLogs).toBe(0);
  });

  it("allows the override once granted posPriceOverride, and writes exactly one audit entry with the correct old/new prices and the resulting invoice", async () => {
    await prisma.positionPermission.create({
      data: { positionId, moduleId: "sales", extra: { posDeferredSale: false, posPriceOverride: true } },
    });

    const { invoice } = await createPosSale(tenantId, userId, "accountant", {
      companyId,
      date: new Date("2026-01-11"),
      lines: [baseLine(120)],
      payments: [{ method: "cash", amount: 120 }],
    });
    expect(invoice.status).toBe("posted");
    expect(Number(invoice.lines[0].unitPrice)).toBe(120);

    const logs = await prisma.auditLog.findMany({ where: { tenantId, action: "pos_sale.price_override" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(userId);
    expect(logs[0].entityType).toBe("SalesInvoice");
    expect(logs[0].entityId).toBe(invoice.id);
    expect(logs[0].metadata).toEqual({ itemId, originalPrice: 100, newPrice: 120 });
  });

  // ملاحظة: الافتراضي الفعلي لـpriceIncludesVat في الطلب الحقيقي يُطبَّق في طبقة Zod
  // (createPosSaleSchema عبر salesInvoiceLineSchema المشتركة، middleware/validate.ts يستبدل
  // req.body بالنسخة المُحلَّلة) — لا داخل pos.service.ts/computeInvoiceLine نفسيهما. استدعاء
  // createPosSale مباشرة (كما في بقية هذا الملف) يتجاوز تلك الطبقة، فإثبات ثبات الإجمالي عند حذف
  // الحقل يجب أن يمرّ عبر نفس مسار Zod الحقيقي — راجع pos.schemas.test.ts.
});
