import { z } from "zod";

export const createControllerSchema = z
  .object({
    companyId: z.string().min(1),
    costCenterId: z.string().min(1),
    deviceSerial: z.string().trim().min(1, "معرّف لوحة المتحكم مطلوب"),
    name: z.string().optional(),
    firmwareVersion: z.string().optional(),
    silentAfterMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  })
  .strict();

export const updateControllerSchema = z
  .object({
    name: z.string().optional(),
    firmwareVersion: z.string().optional(),
    silentAfterMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const setNozzleMapSchema = z
  .object({
    ptsPump: z.coerce.number().int().min(1).max(120),
    ptsNozzle: z.coerce.number().int().min(1).max(8),
    nozzleId: z.string().min(1).nullable(),
  })
  .strict();

export const authorizePumpSchema = z
  .object({
    companyId: z.string().min(1),
    ptsPump: z.coerce.number().int().min(1).max(100),
    ptsNozzle: z.coerce.number().int().min(1).max(6).nullable().optional(),
    presetType: z.enum(["Amount", "Volume", "FullTank"]),
    // حدود معقولة لأمر يدوي: 10,000 ريال أو 2,000 لتر للعملية الواحدة
    dose: z.coerce.number().positive().max(10000).nullable().optional(),
    price: z.coerce.number().positive().max(1000).nullable().optional(),
  })
  .strict();

export const stopPumpSchema = z
  .object({
    companyId: z.string().min(1),
    // 0 مع الإيقاف الطارئ = كل المضخات (PumpEmergencyStop)
    ptsPump: z.coerce.number().int().min(0).max(100),
    emergency: z.boolean().optional(),
  })
  .strict();
