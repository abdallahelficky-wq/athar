import { z } from "zod";

export const createInOutSchema = z.object({
  type: z.enum(["in", "out"]),
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  date: z.coerce.date(),
  note: z.string().optional(),
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
