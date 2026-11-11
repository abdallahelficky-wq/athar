import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import * as service from "./stationDashboard.service";
import { getStationLive } from "./stationLive.service";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

function requireCompany(req: Parameters<RequestHandler>[0]) {
  const companyId = q(req.query.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

/** الفترة بأيام الرياض — الافتراضي اليوم وحده. */
function range(req: Parameters<RequestHandler>[0]) {
  const today = riyadhCalendarDay(new Date());
  const from = q(req.query.from) ?? today;
  const to = q(req.query.to) ?? today;
  if (!dateOnly.test(from) || !dateOnly.test(to)) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  return { from, to };
}

export const overviewHandler: RequestHandler = async (req, res) => {
  res.json(await service.getStationsOverview(req.auth!.tenantId, requireCompany(req), range(req)));
};

export const stationHandler: RequestHandler = async (req, res) => {
  res.json(await service.getStationDetail(req.auth!.tenantId, requireCompany(req), req.params.costCenterId, range(req)));
};

export const stationLiveHandler: RequestHandler = async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await getStationLive(req.auth!.tenantId, requireCompany(req), req.params.costCenterId));
};
