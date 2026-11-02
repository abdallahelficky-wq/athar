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
