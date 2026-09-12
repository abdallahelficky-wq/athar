import { z } from "zod";

// costCenterId وopeningReading غير معرَّفين في أي من هذه المخططات عمداً — .strict() يرفض أي محاولة
// لتمريرهما صراحة بدل تجاهلهما بصمت (كلاهما يُشتَق دائماً من الخادم، لا من الطلب إطلاقاً).

export const openShiftSchema = z
  .object({
    shiftType: z.enum(["morning", "night"]),
  })
  .strict();

export const submitReadingSchema = z
  .object({
    nozzleId: z.string().min(1),
    closingReading: z.coerce.number().nonnegative(),
    testLiters: z.coerce.number().nonnegative().default(0),
    workerConfirmedValue: z.coerce.number().nonnegative(),
    capturedAt: z.coerce.date(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();

export const updateCollectionsSchema = z
  .object({
    networkAmount: z.coerce.number().nonnegative().default(0),
    fuelCardAmount: z.coerce.number().nonnegative().default(0),
    cashDelivered: z.coerce.number().nonnegative(),
  })
  .strict();

export const addCreditSaleSchema = z
  .object({
    customerId: z.string().min(1),
    amount: z.coerce.number().positive(),
    voucherNumber: z.string().min(1),
  })
  .strict();

export const addExpenseSchema = z
  .object({
    amount: z.coerce.number().positive(),
    category: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export const correctReadingSchema = z
  .object({
    accountantConfirmedValue: z.coerce.number().nonnegative(),
  })
  .strict();

export const rejectShiftSchema = z
  .object({
    reasonCode: z.string().min(1),
    note: z.string().optional(),
  })
  .strict();
