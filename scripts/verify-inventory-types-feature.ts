/**
 * اختبار تكامل شامل محلي (Prisma حقيقي، لا محاكاة) للميزة الجديدة (non_stock + تفعيل
 * periodic_inventory + شاشة تسوية الجرد الدوري) — يُنشئ tenant/company تجريبيين مؤقتين، يمرّ
 * بدورة شراء/بيع حقيقية عبر خدمات التطبيق الفعلية (createPurchaseInvoice/createSalesInvoice
 * الحقيقية، لا نسخة مبسَّطة)، ويتحقق من الآثار الجانبية الفعلية في قاعدة البيانات.
 *
 * يغطي:
 *   1) non_stock: شراء (مدين expenseAccountId، بلا أي StockMovement) وبيع (دائن revenueAccountId،
 *      بلا فحص رصيد وبلا قيد COGS) رغم عدم شراء أي كمية فعلياً قبل البيع.
 *   2) periodic_inventory: شراء (مدين purchasesAccountId، averageCost يبقى 0، StockMovement "in"
 *      يُنشأ للتتبّع التشغيلي)، وبيع بكمية أكبر من المشتراة (يُسمح به، بلا قيد COGS، StockMovement
 *      "out" يُنشأ رغم تجاوز الرصيد).
 *   3) تسوية الجرد الدوري بدورتين كاملتين (نفس المثال الرقمي في periodicSettlement.service.test.ts)
 *      — تحقّق من القيد الفعلي المُنشَأ في قاعدة البيانات (الحسابات والمبالغ)، ثم إعادة تشغيل نفس
 *      التسوية بنفس الأرقام للتأكد من idempotency (صفر قيود جديدة).
 *   4) اختبار رجعي (regression) للأنواع الستة الموجودة سابقاً (inventory, expense, service,
 *      fixed_asset, raw_material, bundle) — دورة شراء/بيع واقعية لكل نوع (حيثما ينطبق) للتأكد أن
 *      سلوكها الأصلي (قيد COGS، فحص الرصيد، منع الشراء/البيع) لم يتأثر إطلاقاً.
 *
 * الاستخدام: DATABASE_URL=<محلي> npx tsx scripts/verify-inventory-types-feature.ts
 */
import { PrismaClient } from "@prisma/client";
import { createItemWithComponents } from "../src/modules/items/items.service";
import { createPurchaseInvoice } from "../src/modules/purchaseInvoices/purchaseInvoices.service";
import { createSalesInvoice } from "../src/modules/salesInvoices/salesInvoices.service";
import { createSettlement } from "../src/modules/periodicSettlement/periodicSettlement.service";

const prisma = new PrismaClient();

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function createTempTenantCompany(namePrefix: string) {
  const tenant = await prisma.tenant.create({ data: { name: `${namePrefix} tenant`, unlockPin: "test-placeholder" } });
  const company = await prisma.company.create({ data: { tenantId: tenant.id, name: `${namePrefix} company` } });
  const warehouse = await prisma.warehouse.create({ data: { tenantId: tenant.id, companyId: company.id, name: "المستودع الرئيسي", isDefault: true } });
  const customer = await prisma.customer.create({ data: { tenantId: tenant.id, companyId: company.id, name: "عميل تجريبي" } });
  const supplier = await prisma.supplier.create({ data: { tenantId: tenant.id, companyId: company.id, name: "مورد تجريبي" } });
  // حسابات ضريبة القيمة المضافة المطلوبة من buildJournalLines لأي فاتورة (مشتريات/مبيعات) بصرف
  // النظر عن نوع الصنف — بلا علاقة بمنطق non_stock/periodic_inventory الجديد.
  await prisma.account.create({ data: { tenantId: tenant.id, companyId: company.id, code: "113001", name: "ضريبة القيمة المضافة - مدخلات", type: "asset", level: 4, isPosting: true } });
  await prisma.account.create({ data: { tenantId: tenant.id, companyId: company.id, code: "213002", name: "ضريبة القيمة المضافة - مخرجات", type: "liability", level: 4, isPosting: true } });
  await prisma.account.create({ data: { tenantId: tenant.id, companyId: company.id, code: "212001", name: "ذمم دائنة - موردين", type: "liability", level: 4, isPosting: true } });
  await prisma.account.create({ data: { tenantId: tenant.id, companyId: company.id, code: "112002", name: "ذمم مدينة", type: "asset", level: 4, isPosting: true } });
  return { tenant, company, warehouse, customer, supplier };
}

async function createAccount(tenantId: string, companyId: string, code: string, name: string, type: "asset" | "expense" | "revenue") {
  return prisma.account.create({ data: { tenantId, companyId, code, name, type, level: 4, isPosting: true } });
}

async function cleanupTenant(tenantId: string) {
  // كل هذه الجداول تشير لـAccount بـonDelete: Restrict عمداً (سلامة مالية) — يجب حذفها صراحة قبل
  // حذف الـtenant (الذي يُسقط Account تِبَعاً عبر Cascade من Company)، وإلا يفشل الحذف بخطأ FK.
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.purchaseInvoice.deleteMany({ where: { tenantId } });
  await prisma.salesInvoice.deleteMany({ where: { tenantId } });
  await prisma.fixedAsset.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

async function main() {
  // ============ اختبار 1: non_stock ============
  console.log(`\n${"=".repeat(60)}\nاختبار 1: non_stock — شراء ثم بيع مباشرة، بلا أي تتبّع كمية\n${"=".repeat(60)}`);
  const t1 = await createTempTenantCompany("non-stock");
  try {
    const expenseAcc = await createAccount(t1.tenant.id, t1.company.id, "600001", "مصروف تجريبي", "expense");
    const revenueAcc = await createAccount(t1.tenant.id, t1.company.id, "400001", "إيراد تجريبي", "revenue");
    const item = await createItemWithComponents(t1.tenant.id, {
      companyId: t1.company.id, code: "NS1", name: "خدمة استشارية غير مخزنة", type: "non_stock",
      expenseAccountId: expenseAcc.id, revenueAccountId: revenueAcc.id,
    });

    const purchase = await createPurchaseInvoice(t1.tenant.id, "test-user", {
      companyId: t1.company.id, supplierId: t1.supplier.id, date: new Date("2026-01-01"),
      lines: [{ accountId: "", itemId: item.id, quantity: 1, unitPrice: 100 }],
    });
    const purchaseEntry = await prisma.journalEntry.findFirst({ where: { id: purchase.journalEntryId! }, include: { lines: true } });
    check("قيد الشراء يحتوي سطراً مديناً على expenseAccountId", !!purchaseEntry?.lines.some((l) => l.accountId === expenseAcc.id && Number(l.debit) === 100));
    const movementsAfterPurchase = await prisma.stockMovement.count({ where: { tenantId: t1.tenant.id, itemId: item.id } });
    check("لا يوجد أي StockMovement بعد الشراء", movementsAfterPurchase === 0, `الفعلي=${movementsAfterPurchase}`);
    const itemAfterPurchase = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    check("averageCost يبقى 0 بعد الشراء", Number(itemAfterPurchase.averageCost) === 0);

    // بيع بلا أي كمية "متاحة" مسبقاً — يجب أن ينجح بلا أي فحص رصيد لأنه غير متتبَّع كمية إطلاقاً
    const sale = await createSalesInvoice(t1.tenant.id, "test-user", {
      companyId: t1.company.id, customerId: t1.customer.id, date: new Date("2026-01-02"),
      lines: [{ accountId: "", itemId: item.id, quantity: 500, unitPrice: 10 }],
    });
    const saleEntry = await prisma.journalEntry.findFirst({ where: { id: sale.journalEntryId! }, include: { lines: true } });
    check("قيد البيع يحتوي سطراً دائناً على revenueAccountId", !!saleEntry?.lines.some((l) => l.accountId === revenueAcc.id && Number(l.credit) === 5000));
    check("لا يوجد أي سطر مدين على expenseAccountId ضمن قيد البيع (بلا COGS)", !saleEntry?.lines.some((l) => l.accountId === expenseAcc.id));
    const movementsAfterSale = await prisma.stockMovement.count({ where: { tenantId: t1.tenant.id, itemId: item.id } });
    check("لا يوجد أي StockMovement بعد البيع أيضاً", movementsAfterSale === 0, `الفعلي=${movementsAfterSale}`);
  } finally {
    await cleanupTenant(t1.tenant.id);
  }

  // ============ اختبار 2: periodic_inventory — شراء ثم بيع بكمية أكبر من المتاح ============
  console.log(`\n${"=".repeat(60)}\nاختبار 2: periodic_inventory — بيع بكمية أكبر من المشتراة يجب أن ينجح\n${"=".repeat(60)}`);
  const t2 = await createTempTenantCompany("periodic-inv");
  try {
    const purchasesAcc = await createAccount(t2.tenant.id, t2.company.id, "511001", "مشتريات تجريبية", "expense");
    const stockAcc = await createAccount(t2.tenant.id, t2.company.id, "114001", "مخزون جرد دوري تجريبي", "asset");
    const revenueAcc = await createAccount(t2.tenant.id, t2.company.id, "400002", "إيراد تجريبي 2", "revenue");
    const item = await createItemWithComponents(t2.tenant.id, {
      companyId: t2.company.id, code: "PI1", name: "بضاعة بجرد دوري تجريبية", type: "periodic_inventory",
      purchasesAccountId: purchasesAcc.id, stockAccountId: stockAcc.id, revenueAccountId: revenueAcc.id,
    });

    const purchase = await createPurchaseInvoice(t2.tenant.id, "test-user", {
      companyId: t2.company.id, supplierId: t2.supplier.id, date: new Date("2026-01-01"),
      lines: [{ accountId: "", itemId: item.id, warehouseId: t2.warehouse.id, quantity: 10, unitPrice: 5 }],
    });
    const purchaseEntry = await prisma.journalEntry.findFirst({ where: { id: purchase.journalEntryId! }, include: { lines: true } });
    check("قيد الشراء يحتوي سطراً مديناً على purchasesAccountId (لا stockAccountId)", !!purchaseEntry?.lines.some((l) => l.accountId === purchasesAcc.id && Number(l.debit) === 50));
    check("لا يوجد أي سطر على stockAccountId ضمن قيد الشراء", !purchaseEntry?.lines.some((l) => l.accountId === stockAcc.id));
    const inMovement = await prisma.stockMovement.findFirst({ where: { tenantId: t2.tenant.id, itemId: item.id, type: "in" } });
    check('StockMovement من نوع "in" أُنشئ للتتبّع التشغيلي', !!inMovement && Number(inMovement.quantity) === 10);
    const itemAfterPurchase = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    check("averageCost يبقى 0 بعد الشراء (periodic_inventory)", Number(itemAfterPurchase.averageCost) === 0);

    // بيع 100 وحدة رغم شراء 10 فقط — يجب أن ينجح بلا أي اعتراض
    const sale = await createSalesInvoice(t2.tenant.id, "test-user", {
      companyId: t2.company.id, customerId: t2.customer.id, date: new Date("2026-01-02"),
      lines: [{ accountId: "", itemId: item.id, quantity: 100, unitPrice: 8 }],
    });
    check("البيع بكمية أكبر من الرصيد المتاح نجح بلا استثناء", !!sale.id);
    const saleEntry = await prisma.journalEntry.findFirst({ where: { id: sale.journalEntryId! }, include: { lines: true } });
    check("لا يوجد أي قيد COGS (لا سطر على stockAccountId أو purchasesAccountId) ضمن قيد البيع", !saleEntry?.lines.some((l) => l.accountId === stockAcc.id || l.accountId === purchasesAcc.id));
    const outMovement = await prisma.stockMovement.findFirst({ where: { tenantId: t2.tenant.id, itemId: item.id, type: "out" } });
    check('StockMovement من نوع "out" أُنشئ رغم تجاوز الرصيد', !!outMovement && Number(outMovement.quantity) === 100);

    // ============ اختبار 3: تسوية الجرد الدوري — دورتان كاملتان على نفس هذا الصنف ============
    console.log(`\n${"=".repeat(60)}\nاختبار 3: تسوية الجرد الدوري — دورتان كاملتان (يطابق المثال الرقمي في الاختبار الوحدوي)\n${"=".repeat(60)}`);

    // نُصفّر حركات المخزون أولاً لضبط تجربة نظيفة تطابق المثال الرقمي بالضبط (تتبّع=300 مباشرة)
    await prisma.stockMovement.deleteMany({ where: { tenantId: t2.tenant.id, itemId: item.id } });
    await prisma.stockMovement.create({ data: { tenantId: t2.tenant.id, companyId: t2.company.id, itemId: item.id, warehouseId: t2.warehouse.id, type: "in", quantity: 300, unitCost: 1, date: new Date("2026-01-01") } });

    const cycle1 = await createSettlement(t2.tenant.id, "test-user", t2.company.id, new Date("2026-02-01"), [{ itemId: item.id, countedQuantity: 300, unitCost: 1 }]);
    check("الدورة 1: صافي التسوية = 300 (افتتاحي 0 -> 300)", cycle1[0].netAdjustment === 300, `الفعلي=${cycle1[0].netAdjustment}`);
    const entry1 = await prisma.journalEntry.findFirst({ where: { tenantId: t2.tenant.id, companyId: t2.company.id, sourceModule: "periodic_inventory_settlement" }, include: { lines: true }, orderBy: { createdAt: "desc" } });
    check("قيد الدورة 1: مدين stockAccountId بـ300", !!entry1?.lines.some((l) => l.accountId === stockAcc.id && Number(l.debit) === 300));
    check("قيد الدورة 1: دائن purchasesAccountId بـ300", !!entry1?.lines.some((l) => l.accountId === purchasesAcc.id && Number(l.credit) === 300));
    const itemAfterCycle1 = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    check("periodicStockValue أصبحت 300 بعد الدورة 1", Number(itemAfterCycle1.periodicStockValue) === 300);

    // دورة 2: مشتريات جديدة 500 وحدة، ثم جرد فعلي = 200 وحدة (تكلفة 1)
    await prisma.stockMovement.create({ data: { tenantId: t2.tenant.id, companyId: t2.company.id, itemId: item.id, warehouseId: t2.warehouse.id, type: "in", quantity: 500, unitCost: 1, date: new Date("2026-02-15"), note: "مشتريات دورة 2 (تحاكي فاتورة شراء)" } });
    const cycle2 = await createSettlement(t2.tenant.id, "test-user", t2.company.id, new Date("2026-03-01"), [{ itemId: item.id, countedQuantity: 200, unitCost: 1 }]);
    check("الدورة 2: صافي التسوية = -100 (300 + 500 مشتريات - 200 = 600 تكلفة، لكن صافي التسوية = 200-300=-100)", cycle2[0].netAdjustment === -100, `الفعلي=${cycle2[0].netAdjustment}`);
    const itemAfterCycle2 = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    check("periodicStockValue أصبحت 200 بعد الدورة 2", Number(itemAfterCycle2.periodicStockValue) === 200);

    // Idempotency: إعادة نفس تسوية الدورة 2 بالضبط يجب ألا تُنشئ أي قيد جديد
    const entriesBeforeRerun = await prisma.journalEntry.count({ where: { tenantId: t2.tenant.id, sourceModule: "periodic_inventory_settlement" } });
    const rerun = await createSettlement(t2.tenant.id, "test-user", t2.company.id, new Date("2026-03-01"), [{ itemId: item.id, countedQuantity: 200, unitCost: 1 }]);
    const entriesAfterRerun = await prisma.journalEntry.count({ where: { tenantId: t2.tenant.id, sourceModule: "periodic_inventory_settlement" } });
    check("إعادة تشغيل نفس التسوية لا تُنشئ أي قيد جديد (idempotency)", entriesAfterRerun === entriesBeforeRerun, `قبل=${entriesBeforeRerun} بعد=${entriesAfterRerun}`);
    check("إعادة التشغيل تُرجع netAdjustment=0", rerun[0].netAdjustment === 0);
  } finally {
    await cleanupTenant(t2.tenant.id);
  }

  // ============ اختبار 4: رجعي (regression) للأنواع الستة الموجودة سابقاً ============
  console.log(`\n${"=".repeat(60)}\nاختبار 4: رجعي — الأنواع الستة الموجودة سابقاً (inventory, expense, service, fixed_asset, raw_material, bundle)\n${"=".repeat(60)}`);
  const t4 = await createTempTenantCompany("regression");
  try {
    const stockAcc = await createAccount(t4.tenant.id, t4.company.id, "114002", "مخزون عادي", "asset");
    const cogsAcc = await createAccount(t4.tenant.id, t4.company.id, "511002", "تكلفة بضاعة مباعة", "expense");
    const revenueAcc = await createAccount(t4.tenant.id, t4.company.id, "400003", "إيراد مبيعات", "revenue");
    const expenseAcc = await createAccount(t4.tenant.id, t4.company.id, "600002", "مصروف عادي", "expense");
    const serviceRevenueAcc = await createAccount(t4.tenant.id, t4.company.id, "400004", "إيراد خدمي", "revenue");
    const rawMatStockAcc = await createAccount(t4.tenant.id, t4.company.id, "114003", "مخزون مواد أولية", "asset");
    const bundleStockAcc = await createAccount(t4.tenant.id, t4.company.id, "114004", "مخزون منتج مجمّع", "asset");
    const bundleCogsAcc = await createAccount(t4.tenant.id, t4.company.id, "511003", "تكلفة منتج مجمّع", "expense");
    const bundleRevenueAcc = await createAccount(t4.tenant.id, t4.company.id, "400005", "إيراد منتج مجمّع", "revenue");
    const assetAcquisitionAcc = await createAccount(t4.tenant.id, t4.company.id, "121001", "اقتناء أصول", "asset");
    const accumDeprAcc = await createAccount(t4.tenant.id, t4.company.id, "121002", "مجمع إهلاك", "asset");
    const deprExpenseAcc = await createAccount(t4.tenant.id, t4.company.id, "511004", "مصروف إهلاك", "expense");

    // --- inventory: شراء ثم بيع، يجب أن يُنشئ قيد COGS ويحدّث averageCost ---
    const invItem = await createItemWithComponents(t4.tenant.id, {
      companyId: t4.company.id, code: "INV1", name: "صنف مخزوني عادي", type: "inventory",
      stockAccountId: stockAcc.id, cogsAccountId: cogsAcc.id, revenueAccountId: revenueAcc.id,
    });
    await createPurchaseInvoice(t4.tenant.id, "test-user", {
      companyId: t4.company.id, supplierId: t4.supplier.id, date: new Date("2026-01-01"),
      lines: [{ accountId: "", itemId: invItem.id, warehouseId: t4.warehouse.id, quantity: 10, unitPrice: 20 }],
    });
    const invAfterPurchase = await prisma.item.findUniqueOrThrow({ where: { id: invItem.id } });
    check("inventory: averageCost تحدَّث فعلياً بعد الشراء (لم يتأثر بمنطق non_stock/periodic)", Number(invAfterPurchase.averageCost) === 20);
    const invSale = await createSalesInvoice(t4.tenant.id, "test-user", {
      companyId: t4.company.id, customerId: t4.customer.id, date: new Date("2026-01-02"),
      lines: [{ accountId: "", itemId: invItem.id, quantity: 3, unitPrice: 50 }],
    });
    const invSaleEntry = await prisma.journalEntry.findFirst({ where: { id: invSale.journalEntryId! }, include: { lines: true } });
    check("inventory: قيد البيع يحتوي COGS (مدين cogsAccountId، دائن stockAccountId) كما كان دائماً", !!invSaleEntry?.lines.some((l) => l.accountId === cogsAcc.id && Number(l.debit) === 60) && !!invSaleEntry?.lines.some((l) => l.accountId === stockAcc.id && Number(l.credit) === 60));
    let overSoldRejected = false;
    try {
      await createSalesInvoice(t4.tenant.id, "test-user", {
        companyId: t4.company.id, customerId: t4.customer.id, date: new Date("2026-01-03"),
        lines: [{ accountId: "", itemId: invItem.id, quantity: 1000, unitPrice: 50 }],
      });
    } catch {
      overSoldRejected = true;
    }
    check("inventory: البيع بكمية أكبر من الرصيد لا يزال يُرفَض (فحص الرصيد لم يُكسَر)", overSoldRejected);

    // --- expense: يُشترى لكن يُمنَع بيعه (لم يتغيّر) ---
    const expItem = await createItemWithComponents(t4.tenant.id, {
      companyId: t4.company.id, code: "EXP1", name: "صنف مصروف عادي", type: "expense", expenseAccountId: expenseAcc.id,
    });
    await createPurchaseInvoice(t4.tenant.id, "test-user", {
      companyId: t4.company.id, supplierId: t4.supplier.id, date: new Date("2026-01-01"),
      lines: [{ accountId: "", itemId: expItem.id, warehouseId: t4.warehouse.id, quantity: 5, unitPrice: 10 }],
    });
    let expenseSaleRejected = false;
    try {
      await createSalesInvoice(t4.tenant.id, "test-user", {
        companyId: t4.company.id, customerId: t4.customer.id, date: new Date("2026-01-02"),
        lines: [{ accountId: "", itemId: expItem.id, quantity: 1, unitPrice: 10 }],
      });
    } catch {
      expenseSaleRejected = true;
    }
    check("expense: لا يزال يُمنَع بيعه (لم يتحوّل عن طريق الخطأ إلى non_stock)", expenseSaleRejected);

    // --- service: يُباع لكن يُمنَع شراؤه (لم يتغيّر) ---
    const svcItem = await createItemWithComponents(t4.tenant.id, {
      companyId: t4.company.id, code: "SVC1", name: "خدمة عادية", type: "service", revenueAccountId: serviceRevenueAcc.id,
    });
    let servicePurchaseRejected = false;
    try {
      await createPurchaseInvoice(t4.tenant.id, "test-user", {
        companyId: t4.company.id, supplierId: t4.supplier.id, date: new Date("2026-01-01"),
        lines: [{ accountId: "", itemId: svcItem.id, warehouseId: t4.warehouse.id, quantity: 1, unitPrice: 10 }],
      });
    } catch {
      servicePurchaseRejected = true;
    }
    check("service: لا يزال يُمنَع شراؤه", servicePurchaseRejected);
    const svcSale = await createSalesInvoice(t4.tenant.id, "test-user", {
      companyId: t4.company.id, customerId: t4.customer.id, date: new Date("2026-01-02"),
      lines: [{ accountId: "", itemId: svcItem.id, quantity: 1, unitPrice: 200 }],
    });
    check("service: البيع لا يزال يعمل بشكل طبيعي", !!svcSale.id);

    // --- raw_material: يُمنَع بيعه المباشر إلا لو allowDirectSale ---
    const rawItem = await createItemWithComponents(t4.tenant.id, {
      companyId: t4.company.id, code: "RAW1", name: "مادة أولية عادية", type: "raw_material", stockAccountId: rawMatStockAcc.id, allowDirectSale: false,
    });
    await createPurchaseInvoice(t4.tenant.id, "test-user", {
      companyId: t4.company.id, supplierId: t4.supplier.id, date: new Date("2026-01-01"),
      lines: [{ accountId: "", itemId: rawItem.id, warehouseId: t4.warehouse.id, quantity: 20, unitPrice: 5 }],
    });
    let rawMaterialSaleRejected = false;
    try {
      await createSalesInvoice(t4.tenant.id, "test-user", {
        companyId: t4.company.id, customerId: t4.customer.id, date: new Date("2026-01-02"),
        lines: [{ accountId: "", itemId: rawItem.id, quantity: 1, unitPrice: 10 }],
      });
    } catch {
      rawMaterialSaleRejected = true;
    }
    check("raw_material: لا يزال يُمنَع بيعه المباشر بلا allowDirectSale", rawMaterialSaleRejected);

    // --- bundle: يُباع مثل inventory تماماً (لا يُشترى مباشرة) ---
    const bundleItem = await createItemWithComponents(t4.tenant.id, {
      companyId: t4.company.id, code: "BUN1", name: "منتج مجمّع", type: "bundle",
      stockAccountId: bundleStockAcc.id, cogsAccountId: bundleCogsAcc.id, revenueAccountId: bundleRevenueAcc.id,
    });
    let bundlePurchaseRejected = false;
    try {
      await createPurchaseInvoice(t4.tenant.id, "test-user", {
        companyId: t4.company.id, supplierId: t4.supplier.id, date: new Date("2026-01-01"),
        lines: [{ accountId: "", itemId: bundleItem.id, warehouseId: t4.warehouse.id, quantity: 1, unitPrice: 10 }],
      });
    } catch {
      bundlePurchaseRejected = true;
    }
    check("bundle: لا يزال يُمنَع شراؤه المباشر", bundlePurchaseRejected);

    // --- fixed_asset: يسجّل أصلاً عند الشراء، يُمنَع بيعه ---
    const assetCategory = await prisma.assetCategory.create({
      data: {
        tenantId: t4.tenant.id, companyId: t4.company.id, groupName: "معدّات", name: "معدّات تجريبية",
        assetAccountId: assetAcquisitionAcc.id, accumulatedDepreciationAccountId: accumDeprAcc.id, depreciationExpenseAccountId: deprExpenseAcc.id,
      },
    });
    const assetItem = await createItemWithComponents(t4.tenant.id, {
      companyId: t4.company.id, code: "FA1", name: "أصل ثابت تجريبي", type: "fixed_asset", assetCategoryId: assetCategory.id,
    });
    const assetPurchase = await createPurchaseInvoice(t4.tenant.id, "test-user", {
      companyId: t4.company.id, supplierId: t4.supplier.id, date: new Date("2026-01-01"),
      lines: [{ accountId: "", itemId: assetItem.id, quantity: 1, unitPrice: 10000, usefulLifeYears: 5, salvageValue: 0 }],
    });
    check("fixed_asset: عملية الشراء نجحت وسجَّلت أصلاً (لم تتأثر بإضافة non_stock للتحقق من الحسابات)", !!assetPurchase.id);
    let assetSaleRejected = false;
    try {
      await createSalesInvoice(t4.tenant.id, "test-user", {
        companyId: t4.company.id, customerId: t4.customer.id, date: new Date("2026-01-02"),
        lines: [{ accountId: "", itemId: assetItem.id, quantity: 1, unitPrice: 5000 }],
      });
    } catch {
      assetSaleRejected = true;
    }
    check("fixed_asset: لا يزال يُمنَع بيعه عبر فاتورة مبيعات", assetSaleRejected);
  } finally {
    await cleanupTenant(t4.tenant.id);
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log("✅ كل اختبارات التكامل والرجوع نجحت — non_stock وperiodic_inventory (بما فيها شاشة التسوية بدورتين وidempotency) يعملان بدقة، وكل الأنواع الستة الموجودة سابقاً بلا أي تغيير في سلوكها.");
    process.exitCode = 0;
  } else {
    console.log(`❌ فشل ${failures} اختباراً — لا تعتمد هذا العمل قبل إصلاح هذا.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
