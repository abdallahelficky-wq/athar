import { z } from "zod";

const product = z.enum(["diesel", "gasoline_91", "gasoline_95"]);
const optionalNumber = z.coerce.number().nullable().optional();

export const createTankSchema = z
  .object({
    companyId: z.string().min(1),
    costCenterId: z.string().min(1),
    code: z.string().trim().min(1, "رقم الخزان مطلوب"),
    product,
    capacityLiters: z.coerce.number().positive("سعة الخزان يجب أن تكون أكبر من صفر"),
    atgTankNumber: z.coerce.number().int().positive().nullable().optional(),
  })
  .strict();

export const updateTankSchema = z
  .object({
    code: z.string().trim().min(1, "رقم الخزان مطلوب").optional(),
    capacityLiters: z.coerce.number().positive("سعة الخزان يجب أن تكون أكبر من صفر").optional(),
    atgTankNumber: z.coerce.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const setNozzleTankSchema = z.object({ tankId: z.string().min(1).nullable() }).strict();

export const createReadingSchema = z
  .object({
    tankId: z.string().min(1),
    purpose: z.enum(["opening", "closing", "pre_delivery", "post_delivery", "spot"]),
    readAt: z.coerce.date(),
    liters: z.coerce.number().nonnegative(),
    heightMm: optionalNumber,
    waterHeightMm: optionalNumber,
    waterLiters: optionalNumber,
    temperatureC: optionalNumber,
    note: z.string().optional(),
  })
  .strict();

export const voidSchema = z.object({ reason: z.string().trim().min(1, "السبب مطلوب") }).strict();

export const createDeliverySchema = z
  .object({
    companyId: z.string().min(1),
    costCenterId: z.string().min(1),
    supplierId: z.string().min(1).nullable().optional(),
    carrierSupplierId: z.string().min(1).nullable().optional(),
    deliveryNoteNumber: z.string().trim().min(1, "رقم سند التسليم مطلوب"),
    tankerPlate: z.string().optional(),
    driverName: z.string().optional(),
    deliveredAt: z.coerce.date(),
    note: z.string().optional(),
    lines: z
      .array(z.object({ tankId: z.string().min(1), noteLiters: z.coerce.number().nonnegative(), receivedLiters: z.coerce.number().nonnegative() }).strict())
      .min(1, "أضف خزاناً واحداً على الأقل للتوريد"),
  })
  .strict();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");

export const postVarianceSchema = z
  .object({ companyId: z.string().min(1), tankId: z.string().min(1), from: day, to: day, note: z.string().optional() })
  .strict();

export const reverseVarianceSchema = z.object({ reason: z.string().trim().min(1, "السبب مطلوب"), date: day.optional() }).strict();
