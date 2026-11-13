import { Router } from "express";
import { authenticateEmployeePortal } from "../../middleware/auth";
import { requirePortalPlanModule } from "../../middleware/subscriptionEnforcement";
import { forbidden } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { getStationsOverview } from "./stationDashboard.service";
import { getStationLive } from "./stationLive.service";
import { listStationMessages, sendStationMessage } from "./stationMessages.service";
import { validateBody } from "../../middleware/validate";
import { z } from "zod";

/**
 * متابعة المحطات من بوابة الجوال لمشرف المحطات (Employee.stationSupervisor) — قراءة فقط: كل محطات شركة الموظف بأيقونة لكل
 * محطة (حالة الجهاز، مبيعات اليوم، الورديات المفتوحة ومبيعاتها، الخزانات، التنبيهات)، والشاشة الحيّة لمحطة واحدة.
 * النطاق = مستأجر الرمز + شركة الموظف من قاعدة البيانات (لا من الطلب): getStationsOverview/getStationLive تجلبان كل شيء
 * بـ tenantId وcompanyId، فمحطة شركة أخرى أو مستأجر آخر "غير موجودة".
 */
export const stationMonitorPortalRoutes = Router();
stationMonitorPortalRoutes.use(authenticateEmployeePortal, requirePortalPlanModule("stationShiftsReports"));

const messageSchema = z.object({ body: z.string().trim().min(1, "نص الرسالة مطلوب").max(500) }).strict();

async function supervisorScope(tenantId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { companyId: true, stationSupervisor: true } });
  if (!employee?.stationSupervisor) throw forbidden("هذه الشاشة لمشرف المحطات فقط");
  return { tenantId, companyId: employee.companyId };
}

stationMonitorPortalRoutes.get("/", async (req, res) => {
  const { tenantId, companyId } = await supervisorScope(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId);
  const today = riyadhCalendarDay(new Date());
  const o = await getStationsOverview(tenantId, companyId, { from: today, to: today });
  res.set("Cache-Control", "no-store");
  res.json({
    day: today,
    totals: { todayLiters: o.totals.todayLiters, todayAmount: o.totals.todayAmount },
    stations: o.stations.map((s) => ({
      costCenterId: s.costCenterId, name: s.name, controller: s.controller && { health: s.controller.health, lastSeenAt: s.controller.lastSeenAt },
      today: s.today && { liters: s.today.liters, amount: s.today.amount, count: s.today.count },
      openShifts: s.openShifts, lowTanks: s.lowTanks, alerts7d: s.alerts7d,
    })),
  });
});

stationMonitorPortalRoutes.get("/:costCenterId/live", async (req, res) => {
  const { tenantId, companyId } = await supervisorScope(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId);
  res.set("Cache-Control", "no-store");
  res.json(await getStationLive(tenantId, companyId, req.params.costCenterId));
});

// رسائل المشرف لعمّال المحطة: قائمة آخر 30 (ومعها هل رآها عامل)، وإرسال رسالة جديدة
stationMonitorPortalRoutes.get("/:costCenterId/messages", async (req, res) => {
  const { tenantId, companyId } = await supervisorScope(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId);
  res.json(await listStationMessages(tenantId, companyId, req.params.costCenterId));
});

stationMonitorPortalRoutes.post("/:costCenterId/messages", validateBody(messageSchema), async (req, res) => {
  const { tenantId, companyId } = await supervisorScope(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId);
  res.status(201).json(await sendStationMessage(tenantId, companyId, req.employeeAuth!.employeeId, req.params.costCenterId, req.body.body));
});
