import { RequestHandler } from "express";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./reportSchedules.service";

export const getReportScheduleHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.params.companyId);
  res.json(await service.getReportSchedule(req.auth!.tenantId, req.params.companyId));
};

export const upsertReportScheduleHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.params.companyId);
  res.json(await service.upsertReportSchedule(req.auth!.tenantId, req.params.companyId, req.body));
};

export const sendReportScheduleNowHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.params.companyId);
  res.json(await service.sendReportScheduleNow(req.auth!.tenantId, req.params.companyId));
};
