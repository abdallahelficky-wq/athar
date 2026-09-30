import { POSITION_RESOURCES, MATRIX_ACTIONS } from "../../lib/positionMatrix";
import { z } from "zod";
import { ACTION_LEVELS, PLATFORM_ACTIONS } from "../../lib/platformActions";

// أي وحدة مُسجَّلة فعلياً في PLATFORM_ACTIONS (لا وحدة واحدة مُسمّاة صراحة) — تتسع هذه القائمة
// تلقائياً مع كل وحدة جديدة تُهاجَر للنظام الترتيبي بلا أي تعديل هنا. actionId يُتحقَّق منه
// بالنسبة لنفس moduleId المُرسَل تحديداً عبر refine أدناه، لا بقائمة إجراءات كل الوحدات مجتمعة.
const MODULE_IDS = Object.keys(PLATFORM_ACTIONS) as [string, ...string[]];

function actionExistsInModule(data: { moduleId: string; actionId: string }): boolean {
  return PLATFORM_ACTIONS[data.moduleId]?.some((action) => action.id === data.actionId) ?? false;
}

export const updateActionPermissionSchema = z
  .object({
    moduleId: z.enum(MODULE_IDS),
    actionId: z.string().min(1),
    level: z.enum(ACTION_LEVELS),
  })
  .refine(actionExistsInModule, { message: "الإجراء غير موجود ضمن هذه الوحدة", path: ["actionId"] });

export const upsertUserOverrideSchema = z
  .object({
    userId: z.string().min(1, "المستخدم مطلوب"),
    moduleId: z.enum(MODULE_IDS),
    actionId: z.string().min(1),
    level: z.enum(ACTION_LEVELS),
  })
  .refine(actionExistsInModule, { message: "الإجراء غير موجود ضمن هذه الوحدة", path: ["actionId"] });

export const createPositionSchema = z.object({
  name: z.string().trim().min(1, "اسم المنصب مطلوب").max(100),
  allowUnpost: z.boolean().optional().default(false),
  allowPosDeferredSale: z.boolean().optional().default(false),
  allowPosPriceOverride: z.boolean().optional().default(false),
});

export const updatePositionSchema = z.object({
  allowUnpost: z.boolean().optional(),
  allowPosDeferredSale: z.boolean().optional(),
  allowPosPriceOverride: z.boolean().optional(),
});

export const assignMemberSchema = z.object({
  userId: z.string().min(1, "المستخدم مطلوب"),
});

export const saveMatrixSchema = z.object({
  rows: z.array(z.object({ resourceId: z.string(), read: z.boolean(), create: z.boolean(),
    edit: z.boolean(), delete: z.boolean(), approve: z.boolean() }).strict())
    .max(POSITION_RESOURCES.length)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const row of rows) {
        const resource = POSITION_RESOURCES.find((r) => r.id === row.resourceId);
        if (!resource || seen.has(row.resourceId) || MATRIX_ACTIONS.some((a) => row[a] && !resource.actions.includes(a))) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "صلاحيات غير صالحة أو خدمة مكررة" });
        }
        seen.add(row.resourceId);
      }
    }),
}).strict();
