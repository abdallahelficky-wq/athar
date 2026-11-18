import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as s from "./leaseContracts.schemas";
import * as c from "./leaseContracts.controller";

/**
 * عقود الإيجار وموديول الإيجارات (جدول الدفعات، تأكيد السداد، الإطفاء الشهري). كل مسار يحمل requirePositionAction("leaseContracts", …)
 * مكتوبةً في سطره نفسه (لا عبر ثابت): اختبار positions/positionMatrix.test.ts يفحص نص كل مسار.
 * إدارة العقود وجداولها: المدير المالي. تأكيد السداد وترحيل الإطفاء (ينشئان قيوداً): المحاسب أيضاً. عكس السداد وإزالة الإطفاء
 * يتطلبان صلاحية «فك الترحيل» نفسها التي يتطلبها فك ترحيل قيد يومية.
 */
export const leaseContractRoutes = Router();
leaseContractRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canManage = requireRole("admin", "finance_manager");
const canPost = requireRole("admin", "finance_manager", "accountant");
const canUnpost = requirePermission("accounts", "unpost");

leaseContractRoutes.get("/", requirePositionAction("leaseContracts", "read"), c.listLeaseContracts);
leaseContractRoutes.get("/calendar", requirePositionAction("leaseContracts", "read"), c.calendarHandler);
leaseContractRoutes.get("/alerts", requirePositionAction("leaseContracts", "read"), c.alertsHandler);
leaseContractRoutes.get("/reminders", requirePositionAction("leaseContracts", "read"), c.getReminderHandler);
leaseContractRoutes.put("/reminders", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.reminderSettingSchema), c.saveReminderHandler);
leaseContractRoutes.post("/reminders/send-now", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.sendReminderSchema), c.sendReminderNowHandler);
leaseContractRoutes.get("/amortization", requirePositionAction("leaseContracts", "read"), c.listAmortizationHandler);
leaseContractRoutes.get("/amortization/preview", requirePositionAction("leaseContracts", "read"), c.previewAmortizationHandler);

leaseContractRoutes.post("/", requirePositionAction("leaseContracts", "create"), canManage, validateBody(s.createLeaseContractSchema), c.createLeaseContract);
leaseContractRoutes.post("/import", requirePositionAction("leaseContracts", "create"), canManage, validateBody(s.importSchema), c.importHandler);
leaseContractRoutes.post("/accounts", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.applyAccountsSchema), c.applyAccountsHandler);
leaseContractRoutes.post("/payments", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.createPaymentSchema), c.createPaymentHandler);
leaseContractRoutes.patch("/payments/:id", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.updatePaymentSchema), c.updatePaymentHandler);
leaseContractRoutes.delete("/payments/:id", requirePositionAction("leaseContracts", "edit"), canManage, c.deletePaymentHandler);
leaseContractRoutes.post("/payments/:id/confirm", requirePositionAction("leaseContracts", "edit"), canPost, validateBody(s.confirmPaymentSchema), c.confirmPaymentHandler);
leaseContractRoutes.post("/payments/:id/reverse", requirePositionAction("leaseContracts", "edit"), canPost, canUnpost, validateBody(s.reversePaymentSchema), c.reversePaymentHandler);
leaseContractRoutes.post("/amortization", requirePositionAction("leaseContracts", "edit"), canPost, validateBody(s.postAmortizationSchema), c.postAmortizationHandler);
leaseContractRoutes.delete("/amortization/:id", requirePositionAction("leaseContracts", "edit"), canPost, canUnpost, validateBody(s.removeAmortizationSchema), c.removeAmortizationHandler);

leaseContractRoutes.post("/:id/schedule", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.generateScheduleSchema), c.generateScheduleHandler);
leaseContractRoutes.post("/:id/status", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.contractStatusSchema), c.setStatusHandler);
leaseContractRoutes.patch("/:id", requirePositionAction("leaseContracts", "edit"), canManage, validateBody(s.updateLeaseContractSchema), c.updateLeaseContract);
leaseContractRoutes.delete("/:id", requirePositionAction("leaseContracts", "delete"), canManage, c.deleteLeaseContract);
