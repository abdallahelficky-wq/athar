import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { supportHandler } from "./ai.controller";
import { aiRateLimit } from "./aiRateLimit";

/**
 * «الدعم الفني» في أثر الذكي — راوتر مستقل يُركَّب على /api/ai/support قبل aiRoutes (app.ts)، لأنه ليس مورد "ai" المالي:
 * - لا يقرأ ولا يكتب أي بيانات شركة (أسئلة استخدام النظام فقط)، فلا صلاحية منصب ولا وحدة باقة له
 *   (مُعفى بسببه في subscriptionWriteRoutes.coverage.test.ts).
 * - لا يمر بحارس "عرض فقط": صاحب الاشتراك المنتهي هو أحوج من يسأل الدعم.
 * - متاح لكل مستخدم مسجَّل، بحدّ استخدام خاص به (20 سؤالاً/ساعة) لأنه يستدعي نموذجاً مدفوعاً.
 */
export const aiSupportRoutes = Router();
aiSupportRoutes.post("/", authenticate, aiRateLimit(20), supportHandler);
