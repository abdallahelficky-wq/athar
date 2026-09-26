import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { getItemCard } from "./stockMovements.service";

// اختبار تكامل حقيقي على Postgres فعلي (لا Prisma مُموَّهة) — نفس مبرر
// salesInvoicesSearch.integration.test.ts بالضبط: القيمة الحقيقية هنا (الرصيد الافتتاحي، المشي
// للأمام عبر أنواع حركة مختلفة الإشارة، وحلّ رقم المستند عبر جدولين منفصلين بلا علاقة Prisma
// معرَّفة) تكمن في التفاعل بين استعلامات حقيقية متعددة، لا في أي منطق يمكن اختباره بتمويه بسيط.
guardAgainstUnsafeIntegrationTestDatabase();

describe("getItemCard (integration)", () => {
  let tenantId: string;
  let otherTenantId: string;
  let companyId: string;
  let otherCompanyId: string;
  let itemId: string;
  let warehouseId: string;
  let customerId: string;
  let supplierId: string;
  let revenueAccountId: string;
  let purchaseAccountId: string;

  const movementIds: Record<string, string> = {};

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Item Card Tenant", unlockPin: "hashed" } });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({ data: { name: "Item Card Tenant Other", unlockPin: "hashed" } });
    otherTenantId = otherTenant.id;

    const company = await prisma.company.create({ data: { tenantId, name: "Co A" } });
    companyId = company.id;
    const otherCompany = await prisma.company.create({ data: { tenantId, name: "Co B" } });
    otherCompanyId = otherCompany.id;
    const otherTenantCompany = await prisma.company.create({ data: { tenantId: otherTenantId, name: "Co Other Tenant" } });

    const warehouse = await prisma.warehouse.create({ data: { tenantId, companyId, name: "المستودع الرئيسي" } });
    warehouseId = warehouse.id;
    const otherCompanyWarehouse = await prisma.warehouse.create({ data: { tenantId, companyId: otherCompanyId, name: "مستودع شركة أخرى" } });
    const otherTenantWarehouse = await prisma.warehouse.create({ data: { tenantId: otherTenantId, companyId: otherTenantCompany.id, name: "مستودع مستأجر آخر" } });

    revenueAccountId = (
      await prisma.account.create({ data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" } })
    ).id;
    purchaseAccountId = (
      await prisma.account.create({ data: { tenantId, companyId, code: "5001", level: 1, isPosting: true, name: "المخزون", type: "asset" } })
    ).id;

    const item = await prisma.item.create({
      data: { tenantId, companyId, code: "ITM-1", name: "صنف اختبار", type: "inventory", stockAccountId: purchaseAccountId, cogsAccountId: purchaseAccountId, revenueAccountId },
    });
    itemId = item.id;
    const otherCompanyItem = await prisma.item.create({ data: { tenantId, companyId: otherCompanyId, code: "ITM-1", name: "صنف شركة أخرى", type: "inventory" } });
    const otherTenantItem = await prisma.item.create({ data: { tenantId: otherTenantId, companyId: otherTenantCompany.id, code: "ITM-1", name: "صنف مستأجر آخر", type: "inventory" } });

    customerId = (await prisma.customer.create({ data: { tenantId, companyId, name: "عميل اختبار" } })).id;
    supplierId = (await prisma.supplier.create({ data: { tenantId, companyId, name: "مورّد اختبار" } })).id;

    const purchaseInvoice = await prisma.purchaseInvoice.create({
      data: {
        tenantId, companyId, supplierId, invoiceNumber: "PINV-1", date: new Date("2026-01-01"), status: "posted",
        subtotal: 1000, vatTotal: 150, grandTotal: 1150,
      },
    });
    const purchaseLine = await prisma.purchaseInvoiceLine.create({
      data: {
        invoiceId: purchaseInvoice.id, accountId: purchaseAccountId, itemId, warehouseId,
        quantity: 10, unitPrice: 100, subtotal: 1000, vat: 150, total: 1150,
      },
    });

    const salesInvoice = await prisma.salesInvoice.create({
      data: {
        tenantId, companyId, customerId, invoiceNumber: "INV-1", date: new Date("2026-01-10"), invoiceType: "standard", status: "posted",
        subtotal: 400, vatTotal: 60, grandTotal: 460,
      },
    });
    const salesLine = await prisma.salesInvoiceLine.create({
      data: {
        invoiceId: salesInvoice.id, accountId: revenueAccountId, itemId,
        quantity: 4, unitPrice: 100, subtotal: 400, vat: 60, total: 460,
      },
    });

    // حركة وارد من فاتورة شراء (2026-01-01) — 10 وحدات بتكلفة 100
    const inMovement = await prisma.stockMovement.create({
      data: { tenantId, companyId, itemId, warehouseId, type: "in", quantity: 10, unitCost: 100, date: new Date("2026-01-01"), sourcePurchaseInvoiceLineId: purchaseLine.id },
    });
    movementIds.purchaseIn = inMovement.id;

    // حركة صادر من فاتورة بيع (2026-01-10) — 4 وحدات بتكلفة 100 (averageCost وقت البيع)
    const outMovement = await prisma.stockMovement.create({
      data: { tenantId, companyId, itemId, warehouseId, type: "out", quantity: 4, unitCost: 100, date: new Date("2026-01-10"), sourceSalesInvoiceLineId: salesLine.id },
    });
    movementIds.salesOut = outMovement.id;

    // حركة إدخال يدوية (2026-01-15) — 5 وحدات، بلا مستند مصدر
    const manualIn = await prisma.stockMovement.create({
      data: { tenantId, companyId, itemId, warehouseId, type: "in", quantity: 5, unitCost: 100, date: new Date("2026-01-15"), note: "إدخال يدوي" },
    });
    movementIds.manualIn = manualIn.id;

    // تسوية جرد دوري سالبة (2026-01-20) — quantity مُوقَّعة سلباً (نقص 2 وحدة)
    const adjustment = await prisma.stockMovement.create({
      data: { tenantId, companyId, itemId, warehouseId, type: "adjustment", quantity: -2, unitCost: 100, date: new Date("2026-01-20"), note: "تسوية جرد دوري" },
    });
    movementIds.adjustment = adjustment.id;

    // حركة في شركة أخرى ضمن نفس المستأجر — يجب ألا تظهر في كرت صنف الشركة الأولى
    await prisma.stockMovement.create({
      data: { tenantId, companyId: otherCompanyId, itemId: otherCompanyItem.id, warehouseId: otherCompanyWarehouse.id, type: "in", quantity: 999, unitCost: 1, date: new Date("2026-01-01") },
    });

    // حركة في مستأجر مختلف تماماً
    await prisma.stockMovement.create({
      data: { tenantId: otherTenantId, companyId: otherTenantCompany.id, itemId: otherTenantItem.id, warehouseId: otherTenantWarehouse.id, type: "in", quantity: 888, unitCost: 1, date: new Date("2026-01-01") },
    });
  }, 30000);

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { tenantId: { in: [tenantId, otherTenantId] } } } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.purchaseInvoiceLine.deleteMany({ where: { invoice: { tenantId: { in: [tenantId, otherTenantId] } } } });
    await prisma.purchaseInvoice.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.supplier.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.item.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.warehouse.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.account.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.company.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  });

  it("computes a correct running balance across in/out/manual/adjustment movements, in chronological order", async () => {
    const card = await getItemCard(tenantId, itemId, { companyId });

    expect(card.rows.map((r) => r.id)).toEqual([movementIds.purchaseIn, movementIds.salesOut, movementIds.manualIn, movementIds.adjustment]);
    // 0 +10 (in) -4 (out) +5 (manual in) -2 (adjustment) = 9
    expect(card.rows.map((r) => r.runningBalance)).toEqual([10, 6, 11, 9]);
    expect(card.closingBalance).toBe(9);
    expect(card.openingBalance).toBe(0);
  });

  it("splits signed quantity into quantityIn/quantityOut correctly for every movement type, including a negative adjustment", async () => {
    const card = await getItemCard(tenantId, itemId, { companyId });
    const byId = new Map(card.rows.map((r) => [r.id, r]));

    expect(byId.get(movementIds.purchaseIn)).toMatchObject({ quantityIn: 10, quantityOut: 0 });
    expect(byId.get(movementIds.salesOut)).toMatchObject({ quantityIn: 0, quantityOut: 4 });
    expect(byId.get(movementIds.manualIn)).toMatchObject({ quantityIn: 5, quantityOut: 0 });
    expect(byId.get(movementIds.adjustment)).toMatchObject({ quantityIn: 0, quantityOut: 2 });
  });

  it("resolves the source document type/number for invoice-linked movements, and 'manual' for the rest", async () => {
    const card = await getItemCard(tenantId, itemId, { companyId });
    const byId = new Map(card.rows.map((r) => [r.id, r]));

    expect(byId.get(movementIds.purchaseIn)).toMatchObject({ documentType: "purchase_invoice", documentNumber: "PINV-1" });
    expect(byId.get(movementIds.salesOut)).toMatchObject({ documentType: "sales_invoice", documentNumber: "INV-1" });
    expect(byId.get(movementIds.manualIn)).toMatchObject({ documentType: "manual", documentNumber: null });
    expect(byId.get(movementIds.adjustment)).toMatchObject({ documentType: "manual", documentNumber: null });
  });

  it("applies an opening balance from movements strictly before dateFrom, then walks forward only over the filtered range", async () => {
    const card = await getItemCard(tenantId, itemId, { companyId, dateFrom: new Date("2026-01-10") });

    // الرصيد الافتتاحي = صافي الحركات قبل 2026-01-10 فقط = +10 (الوارد بتاريخ 01-01)
    expect(card.openingBalance).toBe(10);
    expect(card.rows.map((r) => r.id)).toEqual([movementIds.salesOut, movementIds.manualIn, movementIds.adjustment]);
    expect(card.rows.map((r) => r.runningBalance)).toEqual([6, 11, 9]);
  });

  it("respects a dateTo upper bound, excluding later movements from both the rows and the closing balance", async () => {
    const card = await getItemCard(tenantId, itemId, { companyId, dateTo: new Date("2026-01-10") });
    expect(card.rows.map((r) => r.id)).toEqual([movementIds.purchaseIn, movementIds.salesOut]);
    expect(card.closingBalance).toBe(6);
  });

  it("shows the unitCost already stored on each movement, without recomputing anything", async () => {
    const card = await getItemCard(tenantId, itemId, { companyId });
    expect(card.rows.every((r) => Number(r.unitCost) === 100)).toBe(true);
  });

  it("scopes strictly to tenant and company: a different company's item is not found, and a different tenant's item is not found", async () => {
    await expect(getItemCard(tenantId, itemId, { companyId: otherCompanyId })).rejects.toThrow(/غير موجود/);
    await expect(getItemCard(otherTenantId, itemId, {})).rejects.toThrow(/غير موجود/);
  });

  it("without companyId, still scopes to the tenant (finds the item across companies in that tenant)", async () => {
    const card = await getItemCard(tenantId, itemId, {});
    expect(card.item.id).toBe(itemId);
    expect(card.closingBalance).toBe(9);
  });
});
