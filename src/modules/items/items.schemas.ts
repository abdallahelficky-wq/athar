import { z } from "zod";

export const ITEM_TYPES = ["inventory", "expense", "service", "fixed_asset", "raw_material", "bundle"] as const;

export const bomLineSchema = z.object({
  componentItemId: z.string().min(1),
  quantityPerUnit: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
});

const baseItemFields = {
  companyId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(2, "اسم الصنف قصير جداً"),
  // نص فارغ يُطبَّع إلى undefined حتى لا يتصادم مع صنف آخر بلا باركود على القيد الفريد
  // (تجزئة null المتعددة في Postgres لا تتصادم، لكن "" ليست null فتتصادم لو تُركت كما هي).
  barcode: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  type: z.enum(ITEM_TYPES).default("inventory"),
  unit: z.string().optional(),
  category: z.string().optional(),
  salePrice: z.coerce.number().min(0).optional(),
  vatApplicable: z.boolean().optional(),
  reorderLevel: z.coerce.number().min(0).optional(),
  isArchived: z.boolean().optional(),
  stockAccountId: z.string().optional(),
  cogsAccountId: z.string().optional(),
  revenueAccountId: z.string().optional(),
  expenseAccountId: z.string().optional(),
  allowDirectSale: z.boolean().optional(),
  assetCategory: z.string().optional(),
};

/** يفحص اكتمال الربط المحاسبي المطلوب لنوع صنف معيّن — يُستخدَم عند الإنشاء وعند أي تعديل يلمس النوع أو الحسابات. */
export function requiredAccountFieldsForType(type: (typeof ITEM_TYPES)[number], allowDirectSale?: boolean) {
  switch (type) {
    case "inventory":
      return ["stockAccountId", "cogsAccountId", "revenueAccountId"] as const;
    case "expense":
      return ["expenseAccountId"] as const;
    case "service":
      return ["revenueAccountId"] as const;
    case "raw_material":
      return allowDirectSale
        ? (["stockAccountId", "revenueAccountId", "cogsAccountId"] as const)
        : (["stockAccountId"] as const);
    case "bundle":
      return ["stockAccountId", "revenueAccountId", "cogsAccountId"] as const;
    case "fixed_asset":
      return [] as const; // الحسابات ثابتة على مستوى الشركة (wellKnownAccounts.ts)، لا ربط لكل صنف
  }
}

const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  stockAccountId: "حساب المخزون",
  cogsAccountId: "حساب تكلفة البضاعة المباعة",
  revenueAccountId: "حساب الإيراد",
  expenseAccountId: "حساب المصروف",
};

export function validateAccountsForType(data: {
  type: (typeof ITEM_TYPES)[number];
  allowDirectSale?: boolean;
  stockAccountId?: string | null;
  cogsAccountId?: string | null;
  revenueAccountId?: string | null;
  expenseAccountId?: string | null;
}): string | null {
  const required = requiredAccountFieldsForType(data.type, data.allowDirectSale ?? false);
  const missing = required.filter((field) => !data[field]);
  if (missing.length) {
    return `الحقول التالية مطلوبة لهذا النوع من الأصناف: ${missing.map((f) => ACCOUNT_FIELD_LABELS[f]).join("، ")}`;
  }
  return null;
}

export const createItemSchema = z
  .object({ ...baseItemFields, components: z.array(bomLineSchema).optional() })
  .superRefine((data, ctx) => {
    const error = validateAccountsForType(data);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["type"] });
    if (data.type === "bundle" && (!data.components || data.components.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "أضف مكوّناً واحداً على الأقل للمنتج المجمّع", path: ["components"] });
    }
  });

// تحديث جزئي — التحقق من اكتمال الحسابات حسب النوع يتم في items.service.ts بعد دمج القيم
// القديمة والجديدة، لأن التعديل الجزئي قد لا يرسل كل الحقول المحاسبية في كل مرة.
export const updateItemSchema = z.object(baseItemFields).partial();

export const setComponentsSchema = z.object({ components: z.array(bomLineSchema) });
