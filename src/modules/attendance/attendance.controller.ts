import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import * as service from "./attendance.service";

export const checkInHandler: RequestHandler = async (req, res) => {
  const record = await service.checkIn(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId, new Date());
  res.status(201).json(record);
};

export const checkOutHandler: RequestHandler = async (req, res) => {
  const record = await service.checkOut(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId, new Date());
  res.json(record);
};

export const myAttendance: RequestHandler = async (req, res) => {
  res.json(await service.myHistory(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId));
};

export const dailyAttendance: RequestHandler = async (req, res) => {
  const { companyId, date } = req.query;
  if (typeof companyId !== "string" || typeof date !== "string") throw badRequest("companyId و date مطلوبان");
  res.json(await service.companyDaily(req.auth!.tenantId, companyId, new Date(date)));
};

export const absentTodayHandler: RequestHandler = async (req, res) => {
  const { companyId, date } = req.query;
  if (typeof companyId !== "string") throw badRequest("companyId مطلوب");
  const targetDate = typeof date === "string" ? new Date(date) : new Date();
  res.json(await service.absentToday(req.auth!.tenantId, companyId, targetDate));
};
