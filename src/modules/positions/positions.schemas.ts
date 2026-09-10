import { z } from "zod";
import { ACTION_LEVELS, PLATFORM_ACTIONS } from "../../lib/platformActions";

// مقصور على وحدة leaveRequests فقط في هذه المرحلة (أول وحدة مُهاجَرة للنظام الترتيبي) — أي moduleId/
// actionId آخر يُرفَض عند التحقق، بصرف النظر عمّا يُرسِله العميل.
const LEAVE_REQUEST_ACTION_IDS = PLATFORM_ACTIONS.leaveRequests.map((a) => a.id) as [string, ...string[]];

export const updateActionPermissionSchema = z.object({
  moduleId: z.literal("leaveRequests"),
  actionId: z.enum(LEAVE_REQUEST_ACTION_IDS),
  level: z.enum(ACTION_LEVELS),
});

export const upsertUserOverrideSchema = z.object({
  userId: z.string().min(1, "المستخدم مطلوب"),
  moduleId: z.literal("leaveRequests"),
  actionId: z.enum(LEAVE_REQUEST_ACTION_IDS),
  level: z.enum(ACTION_LEVELS),
});

export const createPositionSchema = z.object({
  name: z.string().trim().min(1, "اسم المنصب مطلوب").max(100),
  allowUnpost: z.boolean().optional().default(false),
  allowPosDeferredSale: z.boolean().optional().default(false),
});

export const updatePositionSchema = z.object({
  allowUnpost: z.boolean().optional(),
  allowPosDeferredSale: z.boolean().optional(),
});

export const assignMemberSchema = z.object({
  userId: z.string().min(1, "المستخدم مطلوب"),
});
