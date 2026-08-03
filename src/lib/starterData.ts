import { Prisma } from "@prisma/client";
import type { BusinessActivity } from "./chartTemplates";

/**
 * بيانات ابتدائية (نقطة انطلاق فقط، قابلة للتعديل/الحذف بحرية فور الإنشاء) تُزرَع تلقائياً عند
 * إنشاء شركة جديدة: 3-5 أصناف توضيحية لكل نشاط تجاري (مبنية يدوياً — لا تُشتق من ملفات CSV
 * المرجعية، فهي لا تحتوي أصنافاً أصلاً) + عميل نقدي ومورد نقدي لكل شركة بصرف النظر عن نشاطها،
 * حتى يمكن إصدار أول فاتورة مبيعات فوراً بلا أي إعداد يدوي مسبق.
 */

export const CASH_CUSTOMER_NAME = "عميل نقدي";
export const CASH_SUPPLIER_NAME = "مورد نقدي";

interface StarterItemSpec {
  code: string;
  name: string;
  type: "inventory" | "expense" | "service" | "fixed_asset" | "raw_material" | "bundle";
  unit: string;
  // أكواد حسابات هذا القالب تحديداً (من نفس شجرة الحسابات المزروعة للتو لهذه الشركة)
  stockAccountCode?: string;
  cogsAccountCode?: string;
  revenueAccountCode?: string;
  expenseAccountCode?: string;
  // type === "bundle" فقط — يشير لكود (code) صنف آخر معرَّف قبله في نفس القائمة
  componentItemCode?: string;
}

const STARTER_ITEMS_BY_ACTIVITY: Record<BusinessActivity, StarterItemSpec[]> = {
  // مثال المستخدم التوضيحي: صنف خدمي "أعمال مقاولات"
  contracting: [
    { code: "0001", name: "أعمال مقاولات عامة", type: "service", unit: "عقد", revenueAccountCode: "4111" },
    { code: "0002", name: "أعمال إضافية / أوامر تغيير", type: "service", unit: "أمر", revenueAccountCode: "4112" },
    {
      code: "0003",
      name: "مواد بناء عامة",
      type: "inventory",
      unit: "وحدة",
      stockAccountCode: "1141",
      cogsAccountCode: "5111",
      revenueAccountCode: "4111",
    },
  ],
  // مثال المستخدم التوضيحي: مادة أولية عامة + منتج نهائي عام
  manufacturing: [
    { code: "0001", name: "مادة خام عامة", type: "raw_material", unit: "كجم", stockAccountCode: "1141" },
    {
      code: "0002",
      name: "منتج نهائي عام",
      type: "bundle",
      unit: "قطعة",
      stockAccountCode: "1144",
      cogsAccountCode: "5111",
      revenueAccountCode: "4111",
      componentItemCode: "0001",
    },
    { code: "0003", name: "تصنيع لدى الغير (Tolling)", type: "service", unit: "أمر", revenueAccountCode: "4113" },
  ],
  // مثال المستخدم التوضيحي: صنف "بضاعة عامة"
  retail: [
    {
      code: "0001",
      name: "بضاعة عامة",
      type: "inventory",
      unit: "قطعة",
      stockAccountCode: "1141",
      cogsAccountCode: "5111",
      revenueAccountCode: "4111",
    },
    {
      code: "0002",
      name: "عروض وهدايا ترويجية",
      type: "inventory",
      unit: "قطعة",
      stockAccountCode: "1144",
      cogsAccountCode: "5111",
      revenueAccountCode: "4111",
    },
    { code: "0003", name: "قرطاسية ومطبوعات", type: "expense", unit: "وحدة", expenseAccountCode: "6221" },
  ],
  // مثال المستخدم التوضيحي: صنف مخزوني عام واحد
  general_trade: [
    {
      code: "0001",
      name: "صنف تجاري عام",
      type: "inventory",
      unit: "قطعة",
      stockAccountCode: "1141",
      cogsAccountCode: "5111",
      revenueAccountCode: "4111",
    },
    {
      code: "0002",
      name: "بضاعة للتصدير",
      type: "inventory",
      unit: "قطعة",
      stockAccountCode: "1142",
      cogsAccountCode: "5111",
      revenueAccountCode: "4112",
    },
    { code: "0003", name: "عمولة وساطة تجارية", type: "service", unit: "صفقة", revenueAccountCode: "4113" },
  ],
  // مثال المستخدم التوضيحي: بنزين 91/95/ديزل
  fuel_stations: [
    {
      code: "0001",
      name: "بنزين 91",
      type: "inventory",
      unit: "لتر",
      stockAccountCode: "1141",
      cogsAccountCode: "5111",
      revenueAccountCode: "4111",
    },
    {
      code: "0002",
      name: "بنزين 95",
      type: "inventory",
      unit: "لتر",
      stockAccountCode: "1141",
      cogsAccountCode: "5111",
      revenueAccountCode: "4112",
    },
    {
      code: "0003",
      name: "ديزل",
      type: "inventory",
      unit: "لتر",
      stockAccountCode: "1142",
      cogsAccountCode: "5111",
      revenueAccountCode: "4113",
    },
    { code: "0004", name: "تغيير زيت وصيانة سريعة", type: "service", unit: "خدمة", revenueAccountCode: "4114" },
  ],
};

function resolveAccountId(idByCode: Map<string, string>, code: string | undefined, label: string): string | null {
  if (!code) return null;
  const id = idByCode.get(code);
  if (!id) throw new Error(`تعذّر إيجاد الحساب ${code} (${label}) عند زرع الأصناف الافتراضية لهذا النشاط`);
  return id;
}

/** يزرع 3-5 أصناف ابتدائية توضيحية مطابقة لنشاط الشركة — نقطة انطلاق فقط، قابلة للتعديل/الحذف فوراً. */
export async function createStarterItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  activity: BusinessActivity,
  idByCode: Map<string, string>,
) {
  const specs = STARTER_ITEMS_BY_ACTIVITY[activity];
  const itemIdByCode = new Map<string, string>();

  for (const spec of specs) {
    const item = await tx.item.create({
      data: {
        tenantId,
        companyId,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        unit: spec.unit,
        vatApplicable: true,
        stockAccountId: resolveAccountId(idByCode, spec.stockAccountCode, spec.name),
        cogsAccountId: resolveAccountId(idByCode, spec.cogsAccountCode, spec.name),
        revenueAccountId: resolveAccountId(idByCode, spec.revenueAccountCode, spec.name),
        expenseAccountId: resolveAccountId(idByCode, spec.expenseAccountCode, spec.name),
      },
    });
    itemIdByCode.set(spec.code, item.id);

    if (spec.type === "bundle" && spec.componentItemCode) {
      const componentItemId = itemIdByCode.get(spec.componentItemCode);
      if (!componentItemId) {
        throw new Error(`مكوّن الصنف المجمّع ${spec.componentItemCode} غير معرَّف قبل ${spec.code} في قائمة الأصناف الافتراضية`);
      }
      await tx.itemComponent.create({
        data: { tenantId, parentItemId: item.id, componentItemId, quantityPerUnit: 1 },
      });
    }
  }
}

/** ينشئ عميلاً نقدياً ومورداً نقدياً افتراضيين لكل شركة جديدة بصرف النظر عن نشاطها. */
export async function createCashParties(tx: Prisma.TransactionClient, tenantId: string, companyId: string) {
  await tx.customer.create({
    data: { tenantId, companyId, name: CASH_CUSTOMER_NAME, customerType: "individual", paymentTerms: "نقدي" },
  });
  await tx.supplier.create({
    data: { tenantId, companyId, name: CASH_SUPPLIER_NAME, paymentTerms: "نقدي" },
  });
}

/**
 * مستودع افتراضي لكل شركة جديدة — فاتورة المبيعات تشترط وجود مستودع افتراضي واحد قبل بيع أي صنف
 * مخزني (inventory/raw_material/bundle)، وبدونه يفشل إصدار أول فاتورة رغم وجود عميل نقدي وأصناف
 * ابتدائية جاهزة. إضافة غير مطلوبة صراحةً في الطلب الأصلي لكنها ضرورية لتحقيق هدفه الفعلي
 * ("بدون أي إعداد يدوي")، فبدونها يبقى المستخدم مضطراً لإنشاء مستودع يدوياً قبل أول عملية بيع.
 */
export async function createDefaultWarehouse(tx: Prisma.TransactionClient, tenantId: string, companyId: string) {
  await tx.warehouse.create({
    data: { tenantId, companyId, name: "المستودع الرئيسي", code: "MAIN", isDefault: true },
  });
}
