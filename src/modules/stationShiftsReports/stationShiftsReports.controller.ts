import { Request, RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import * as service from "./stationShiftsReports.service";

/** enforceCompanyScope (مُركَّب على الراوتر) يضبط req.query.companyId دائماً بنطاق المستخدم لو لم
 * يُحدَّد صراحة، إلا لعضوية companyScope="all" بلا اختيار صريح — عندها يبقى فارغاً، وهنا تحديداً
 * (خلافاً لـ dashboard.controller.ts) نرفضه بوضوح بدل معاملته كـ"كل الشركات": حسابات إقفال
 * الوردية (resolveShiftClosingAccounts) خاصة بشركة واحدة بعينها، فتجميع صافي النقدية عبر شركات
 * متعددة معاً لا معنى محاسبياً له أصلاً. */
function parseCompanyId(req: Request): string {
  const { companyId } = req.query;
  if (typeof companyId === "string" && companyId) return companyId;
  throw badRequest("companyId مطلوب لتقارير ورديات المحطات");
}

/** نفس افتراضي dashboard.controller.ts تماماً (parseRange هناك): dateTo تُعبَّأ بالآن ما لم
 * تُحدَّد صراحة، وdateFrom بأول يوم من شهر dateTo ما لم يُحدَّد صراحة — لا سلوك جديد يُخترَع هنا. */
function parseRange(req: Request): service.ReportRange {
  const { dateFrom, dateTo } = req.query;
  const dateTo_ = typeof dateTo === "string" ? new Date(dateTo) : new Date();
  const dateFrom_ = typeof dateFrom === "string" ? new Date(dateFrom) : new Date(dateTo_.getFullYear(), dateTo_.getMonth(), 1);
  return { dateFrom: dateFrom_, dateTo: dateTo_ };
}

/** costCenterId قد يتكرر (?costCenterId=a&costCenterId=b) فيصل كمصفوفة، أو مرة واحدة فيصل كنص —
 * غيابه كلياً يعني كل محطات الشركة معاً (راجع resolveCostCenters في الخدمة). */
function parseCostCenterIds(req: Request): string[] | undefined {
  const raw = req.query.costCenterId;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = list.filter((v): v is string => typeof v === "string" && v.length > 0);
  return ids.length > 0 ? ids : undefined;
}

const SALES_VOLUME_GROUP_BY = ["pump", "station", "product"] as const;

function parseGroupBy(req: Request): service.SalesVolumeGroupBy {
  const { groupBy } = req.query;
  if (typeof groupBy === "string" && (SALES_VOLUME_GROUP_BY as readonly string[]).includes(groupBy)) {
    return groupBy as service.SalesVolumeGroupBy;
  }
  throw badRequest("groupBy مطلوب ويجب أن يكون أحد: pump, station, product");
}

export const salesVolumeHandler: RequestHandler = async (req, res) => {
  const result = await service.getSalesVolumeReport(req.auth!.tenantId, parseCompanyId(req), parseGroupBy(req), parseRange(req), parseCostCenterIds(req));
  res.json(result);
};

export const cashSummaryHandler: RequestHandler = async (req, res) => {
  const result = await service.getCashSummaryReport(req.auth!.tenantId, parseCompanyId(req), parseRange(req), parseCostCenterIds(req));
  res.json(result);
};

export const expensesHandler: RequestHandler = async (req, res) => {
  const result = await service.getExpensesReport(req.auth!.tenantId, parseCompanyId(req), parseRange(req), parseCostCenterIds(req));
  res.json(result);
};

export const netCashHandler: RequestHandler = async (req, res) => {
  const result = await service.getNetCashReport(req.auth!.tenantId, parseCompanyId(req), parseRange(req), parseCostCenterIds(req));
  res.json(result);
};

export const seedDataExceptionsHandler: RequestHandler = async (req, res) => {
  const rows = await service.getSeedDataExceptionsReport(req.auth!.tenantId, parseCompanyId(req));
  res.json({ rows });
};
