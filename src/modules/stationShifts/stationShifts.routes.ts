import { Router } from "express";
import { authenticate, enforceCompanyScope, requireActionPermission, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { correctReadingSchema, rejectShiftSchema } from "./stationShifts.schemas";
import {
  listPendingShiftsHandler,
  getShiftByIdHandler,
  correctReadingHandler,
  approveShiftHandler,
  postShiftHandler,
  rejectShiftHandler,
} from "./stationShifts.controller";

/**
 * شاشة المحاسب فقط (User/Position، requireActionPermission) — "review" (approve) للمراجعة/
 * التصحيح/الاعتماد أو الرفض، و"post" (approve) لترحيل وردية مُعتمَدة فعلياً (إنشاء قيدها
 * المحاسبي). منفصلان عمداً رغم تطابق مستوييهما الأدنى اليوم: المستأجر يمنحهما لنفس المنصب حالياً
 * (محاسب واحد يعتمد ويرحّل)، لكن الفصل موجود من الآن ليقدر لاحقاً على فصل "من يعتمد" عن "من
 * يرحّل" بلا أي تعديل في الكود — فقط بإنشاء منصبين بدل واحد من شاشة المناصب.
 *
 * محور "العامل" (فتح وردية، قراءات، تحصيل، مصروفات، إرسال) انتقل بالكامل إلى بوابة الموظف —
 * راجع stationShifts.portal.routes.ts، مُصادَق بـ authenticateEmployeePortal (Employee لا User)،
 * بلا أي مفهوم Position/PositionActionPermission هناك أصلاً (نفس مبدأ leaveRequests.portal.routes.ts
 * تماماً: تخصيص المحطة نفسه هو "الصلاحية" الوحيدة).
 */
export const stationShiftRoutes = Router();
stationShiftRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const reviewAccess = requireActionPermission("stationShifts", "review", "approve");
const postAccess = requireActionPermission("stationShifts", "post", "approve");

stationShiftRoutes.get("/pending", reviewAccess, listPendingShiftsHandler);
stationShiftRoutes.get("/:id", reviewAccess, getShiftByIdHandler);
stationShiftRoutes.put("/:id/readings/:readingId", reviewAccess, validateBody(correctReadingSchema), correctReadingHandler);
stationShiftRoutes.post("/:id/approve", reviewAccess, approveShiftHandler);
stationShiftRoutes.post("/:id/reject", reviewAccess, validateBody(rejectShiftSchema), rejectShiftHandler);

// صلاحية مستقلة عن الاعتماد، راجع التعليق أعلاه
stationShiftRoutes.post("/:id/post", postAccess, postShiftHandler);
