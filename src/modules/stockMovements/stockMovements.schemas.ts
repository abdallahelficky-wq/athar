import { z } from "zod";

export const createInOutSchema = z
  .object({
    type: z.enum(["in", "out"]),
    itemId: z.string().min(1),
    warehouseId: z.string().min(1),
    quantity: z.coerce.number().positive(),
    // إلزامي عند الإدخال فقط — لا يوجد "سعر تكلفة" ثابت قابل للتعديل يدوياً بعد الآن،
    // متوسط التكلفة يُحسَب تلقائياً من تكلفة كل استلام فعلي (انظر costingEngine.ts)
    unitCost: z.coerce.number().min(0).optional(),
    date: z.coerce.date(),
    note: z.string().optional(),
  })
  .refine((data) => data.type !== "in" || data.unitCost != null, {
    message: "أدخل تكلفة الوحدة عند إضافة مخزون",
    path: ["unitCost"],
  });

export const createIssueSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  department: z.string().min(1),
  quantity: z.coerce.number().positive(),
  date: z.coerce.date(),
  note: z.string().optional(),
});

export const createTransferSchema = z.object({
  itemId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  toCompanyId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  date: z.coerce.date(),
});

export const removeSchema = z.object({ pin: z.string().min(1) });
