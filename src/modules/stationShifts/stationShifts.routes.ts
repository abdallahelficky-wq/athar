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
 * موديول واحد (stationShifts) بمحورين مستقلَّين على نظام الصلاحيات الترتيبي الجديد
 * (requireActionPermission، راجع lib/platformActions.ts): "worker" (edit) لكل ما يفعله عامل
 * المحطة على ورديته المفتوحة، و"review" (approve) لكل ما يفعله المحاسب أثناء المراجعة/الاعتماد —
 * محوران منفصلان تماماً (لا أحدهما يتضمن الآخر ضمنياً)، بعكس مستويات approve/edit الترتيبية
 * العامة لنفس actionId، لأن قدرة المحاسب على "المراجعة" لا تعني حاجته لصلاحية "تشغيل" وردية
 * كعامل تشغيل وردية، والعكس صحيح.
 */
export const stationShiftRoutes = Router();
stationShiftRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const workerAccess = requireActionPermission("stationShifts", "worker", "edit");
const reviewAccess = requireActionPermission("stationShifts", "review", "approve");

// عامل المحطة
stationShiftRoutes.get("/my-station", workerAccess, getMyStationHandler);
stationShiftRoutes.post("/", workerAccess, validateBody(openShiftSchema), openShiftHandler);
stationShiftRoutes.post("/:id/readings", workerAccess, validateBody(submitReadingSchema), submitReadingHandler);
stationShiftRoutes.put("/:id/collections", workerAccess, validateBody(updateCollectionsSchema), updateCollectionsHandler);
stationShiftRoutes.post("/:id/credit-sales", workerAccess, validateBody(addCreditSaleSchema), addCreditSaleHandler);
stationShiftRoutes.post("/:id/expenses", workerAccess, validateBody(addExpenseSchema), addExpenseHandler);
stationShiftRoutes.get("/:id/summary", workerAccess, getShiftSummaryHandler);
stationShiftRoutes.post("/:id/submit", workerAccess, submitShiftHandler);

// المحاسب
stationShiftRoutes.get("/pending", reviewAccess, listPendingShiftsHandler);
stationShiftRoutes.get("/:id", reviewAccess, getShiftByIdHandler);
stationShiftRoutes.put("/:id/readings/:readingId", reviewAccess, validateBody(correctReadingSchema), correctReadingHandler);
stationShiftRoutes.post("/:id/approve", reviewAccess, approveShiftHandler);
stationShiftRoutes.post("/:id/post", reviewAccess, postShiftHandler);
stationShiftRoutes.post("/:id/reject", reviewAccess, validateBody(rejectShiftSchema), rejectShiftHandler);
