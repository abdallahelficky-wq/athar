import { RequestHandler } from "express";
import * as service from "./reportSchedules.service";

export const getReportScheduleHandler: RequestHandler = async (req, res) => {
  res.json(await service.getReportSchedule(req.auth!.tenantId, req.params.companyId));
};

export const upsertReportScheduleHandler: RequestHandler = async (req, res) => {
  res.json(await service.upsertReportSchedule(req.auth!.tenantId, req.params.companyId, req.body));
};

export const sendReportScheduleNowHandler: RequestHandler = async (req, res) => {
  res.json(await service.sendReportScheduleNow(req.auth!.tenantId, req.params.companyId));
};
