import { Router } from "express";
import { authenticate, enforceCompanyScope, requireActionPermission, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  openShiftSchema,
  submitReadingSchema,
  updateCollectionsSchema,
  addCreditSaleSchema,
  addExpenseSchema,
  correctReadingSchema,
  rejectShiftSchema,
} from "./stationShifts.schemas";
import {
  getMyStationHandler,
  openShiftHandler,
  submitReadingHandler,
  updateCollectionsHandler,
  addCreditSaleHandler,
  addExpenseHandler,
  getShiftSummaryHandler,
  submitShiftHandler,
  listPendingShiftsHandler,
  getShiftByIdHandler,
  correctReadingHandler,
  approveShiftHandler,
  postShiftHandler,
  rejectShiftHandler,
} from "./stationShifts.controller";

/**
 * موديول واحد (stationShifts) بثلاثة محاور مستقلَّة تماماً على نظام الصلاحيات الترتيبي الجديد
 * (requireActionPermission، راجع lib/platformActions.ts): "worker" (edit) لكل ما يفعله عامل
 * المحطة على ورديته المفتوحة، و"review" (approve) للمراجعة/التصحيح/الاعتماد أو الرفض، و"post"
 * (approve) لترحيل وردية مُعتمَدة فعلياً (إنشاء قيدها المحاسبي). review وpost منفصلان عمداً رغم
 * تطابق مستوييهما الأدنى اليوم: المستأجر يمنحهما لنفس المنصب حالياً (محاسب واحد يعتمد ويرحّل)، لكن
 * الفصل موجود من الآن ليقدر لاحقاً على فصل "من يعتمد" عن "من يرحّل" بلا أي تعديل في الكود — فقط
 * بإنشاء منصبين بدل واحد من شاشة المناصب. لا محور من الثلاثة يتضمن الآخر ضمنياً، بعكس مستويات
 * approve/edit الترتيبية العامة لنفس actionId.
 */
export const stationShiftRoutes = Router();
stationShiftRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const workerAccess = requireActionPermission("stationShifts", "worker", "edit");
const reviewAccess = requireActionPermission("stationShifts", "review", "approve");
const postAccess = requireActionPermission("stationShifts", "post", "approve");

// عامل المحطة
stationShiftRoutes.get("/my-station", workerAccess, getMyStationHandler);
stationShiftRoutes.post("/", workerAccess, validateBody(openShiftSchema), openShiftHandler);
stationShiftRoutes.post("/:id/readings", workerAccess, validateBody(submitReadingSchema), submitReadingHandler);
stationShiftRoutes.put("/:id/collections", workerAccess, validateBody(updateCollectionsSchema), updateCollectionsHandler);
stationShiftRoutes.post("/:id/credit-sales", workerAccess, validateBody(addCreditSaleSchema), addCreditSaleHandler);
stationShiftRoutes.post("/:id/expenses", workerAccess, validateBody(addExpenseSchema), addExpenseHandler);
stationShiftRoutes.get("/:id/summary", workerAccess, getShiftSummaryHandler);
stationShiftRoutes.post("/:id/submit", workerAccess, submitShiftHandler);

// المحاسب — مراجعة/اعتماد/رفض
stationShiftRoutes.get("/pending", reviewAccess, listPendingShiftsHandler);
stationShiftRoutes.get("/:id", reviewAccess, getShiftByIdHandler);
stationShiftRoutes.put("/:id/readings/:readingId", reviewAccess, validateBody(correctReadingSchema), correctReadingHandler);
stationShiftRoutes.post("/:id/approve", reviewAccess, approveShiftHandler);
stationShiftRoutes.post("/:id/reject", reviewAccess, validateBody(rejectShiftSchema), rejectShiftHandler);

// المحاسب — ترحيل (صلاحية مستقلة عن الاعتماد، راجع التعليق أعلاه)
stationShiftRoutes.post("/:id/post", postAccess, postShiftHandler);
