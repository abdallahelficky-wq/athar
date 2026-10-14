import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, authenticateEmployeePortal, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { requirePortalPlanModule } from "../../middleware/subscriptionEnforcement";
import { checkInHandler, checkOutHandler, myAttendance, dailyAttendance, absentTodayHandler } from "./attendance.controller";

export const attendanceRoutes = Router();

// بوابة الموظف (الجوال) — رمز منفصل تماماً، يُطبَّق فقط على هذه المسارات الثلاثة تحديداً
// الحضور من بوابة الموظف وحدة "attendance" في الباقة (المؤسسية) — مراجعة #164
attendanceRoutes.post("/check-in", authenticateEmployeePortal, requirePortalPlanModule("attendance"), checkInHandler);
attendanceRoutes.post("/check-out", authenticateEmployeePortal, requirePortalPlanModule("attendance"), checkOutHandler);
attendanceRoutes.get("/me", authenticateEmployeePortal, myAttendance);

// الواجهة الإدارية (سطح المكتب) — نفس نظام صلاحيات User الحالي
const canView = requireRole("admin", "finance_manager", "hr_manager");
attendanceRoutes.get("/daily", authenticate, requirePositionAction("attendance", "read"), enforceCompanyScope, canView, dailyAttendance);
attendanceRoutes.get("/absent-today", authenticate, requirePositionAction("attendance", "read"), enforceCompanyScope, canView, absentTodayHandler);
