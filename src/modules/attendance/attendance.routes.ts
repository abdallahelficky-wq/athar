import { Router } from "express";
import { authenticate, authenticateEmployeePortal, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { checkInHandler, checkOutHandler, myAttendance, dailyAttendance, absentTodayHandler } from "./attendance.controller";

export const attendanceRoutes = Router();

// بوابة الموظف (الجوال) — رمز منفصل تماماً، يُطبَّق فقط على هذه المسارات الثلاثة تحديداً
attendanceRoutes.post("/check-in", authenticateEmployeePortal, checkInHandler);
attendanceRoutes.post("/check-out", authenticateEmployeePortal, checkOutHandler);
attendanceRoutes.get("/me", authenticateEmployeePortal, myAttendance);

// الواجهة الإدارية (سطح المكتب) — نفس نظام صلاحيات User الحالي
const canView = requireRole("admin", "finance_manager", "hr_manager");
attendanceRoutes.get("/daily", authenticate, enforceCompanyScope, canView, dailyAttendance);
attendanceRoutes.get("/absent-today", authenticate, enforceCompanyScope, canView, absentTodayHandler);
