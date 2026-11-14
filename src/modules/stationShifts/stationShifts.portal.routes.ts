import { Router } from "express";
import { authenticateStationUser } from "../../middleware/auth";
import { requirePortalPlanModule } from "../../middleware/subscriptionEnforcement";
import { validateBody } from "../../middleware/validate";
import { openShiftSchema, submitReadingSchema, updateCollectionsSchema, addCreditSaleSchema, addExpenseSchema } from "./stationShifts.schemas";
import * as service from "./stationShifts.service";
import { uploadSingleFile } from "../attachments/attachments.controller";
import { createAttachment } from "../attachments/attachments.service";
import { badRequest } from "../../lib/httpError";
import { workerStationMessages } from "../stationDashboard/stationMessages.service";

/**
 * محور العامل الوحيد لوحدة ورديات المحطات — تطبيق المحطات بهوية مستخدم المحطات (StationUser، مستقل عن شئون الموظفين منذ
 * 14 نوفمبر 2026؛ كان Employee). ما يلي من الوصف القديم ما زال صحيحاً بإبدال "الموظف" بمستخدم المحطات: بلا أي مفهوم
 * Position/PositionActionPermission هنا إطلاقاً، بنفس مبدأ leaveRequests.portal.routes.ts تماماً:
 * تخصيص المحطة نفسه (StationUser.costCenterId) هو "الصلاحية" الوحيدة المطلوبة — كل دوال
 * service المستدعاة هنا (getWorkerCostCenter/getOwnedOpenShift/getOwnedShift) ترفض بوضوح لو لم
 * تكن هذه الوردية فعلاً وردية هذا الموظف بالذات. شاشة المحاسب (User/Position) منفصلة تماماً تبقى
 * في stationShifts.routes.ts.
 */
export const stationShiftPortalRoutes = Router();
// ورديات العامل من إضافة المحطات (stationShiftsReports) — مراجعة #164؛ القراءة تمرّ
stationShiftPortalRoutes.use(authenticateStationUser, requirePortalPlanModule("stationShiftsReports"));

// رسائل مشرف المحطات لمحطة هذا العامل
stationShiftPortalRoutes.get("/messages", async (req, res) => {
  res.json(await workerStationMessages(req.stationAuth!.tenantId, req.stationAuth!.stationUserId));
});

stationShiftPortalRoutes.get("/my-station", async (req, res) => {
  res.json(await service.getMyStation(req.stationAuth!.tenantId, req.stationAuth!.stationUserId));
});

stationShiftPortalRoutes.post("/", validateBody(openShiftSchema), async (req, res) => {
  const shift = await service.openShift(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.body);
  res.status(201).json(shift);
});

stationShiftPortalRoutes.post("/:id/readings", validateBody(submitReadingSchema), async (req, res) => {
  const reading = await service.submitReading(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id, req.body);
  res.status(201).json(reading);
});

stationShiftPortalRoutes.put("/:id/collections", validateBody(updateCollectionsSchema), async (req, res) => {
  const collection = await service.updateCollections(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id, req.body);
  res.json(collection);
});

stationShiftPortalRoutes.post("/:id/credit-sales", validateBody(addCreditSaleSchema), async (req, res) => {
  const creditSale = await service.addCreditSale(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id, req.body);
  res.status(201).json(creditSale);
});

stationShiftPortalRoutes.post("/:id/expenses", validateBody(addExpenseSchema), async (req, res) => {
  const expense = await service.addExpense(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id, req.body);
  res.status(201).json(expense);
});

stationShiftPortalRoutes.get("/:id/summary", async (req, res) => {
  res.json(await service.getShiftSummary(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id));
});

stationShiftPortalRoutes.post("/:id/submit", async (req, res) => {
  res.json(await service.submitShift(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id));
});

// صور القراءات/المصروفات — نقطة رفع مخصَّصة لبوابة الموظف بدل نظام المرفقات المشترك
// (attachmentRoutes)، الذي يقتصر على authenticate (User) + دور من
// admin/finance_manager/accountant/hr_manager فقط، ولا يقبل رمز بوابة الموظف إطلاقاً. تعيد
// استخدام نفس منطق التخزين (createAttachment) بعد تحقق ملكية صارم هنا (القراءة/المصروف يخص
// فعلاً وردية هذا الموظف بالذات — راجع assertOwnedReading/assertOwnedExpense).
stationShiftPortalRoutes.post("/:id/readings/:readingId/photo", uploadSingleFile, async (req, res) => {
  if (!req.file) throw badRequest("الملف مطلوب");
  const reading = await service.assertOwnedReading(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id, req.params.readingId);
  const attachment = await createAttachment(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, {
    entityType: "station_shift_reading",
    entityId: reading.id,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
  });
  res.status(201).json(attachment);
});

stationShiftPortalRoutes.post("/:id/expenses/:expenseId/photo", uploadSingleFile, async (req, res) => {
  if (!req.file) throw badRequest("الملف مطلوب");
  const expense = await service.assertOwnedExpense(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, req.params.id, req.params.expenseId);
  const attachment = await createAttachment(req.stationAuth!.tenantId, req.stationAuth!.stationUserId, {
    entityType: "station_shift_expense",
    entityId: expense.id,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
  });
  res.status(201).json(attachment);
});
