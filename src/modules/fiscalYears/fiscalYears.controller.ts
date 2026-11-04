import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./fiscalYears.service";

export const fiscalYearSettingsSchema = z.object({
  fiscalYearStartMonth: z.number().int().min(1, "شهر بداية السنة المالية يجب أن يكون من 1 إلى 12").max(12, "شهر بداية السنة المالية يجب أن يكون من 1 إلى 12").optional(),
  fiscalCloseAccountId: z.string().min(1).nullable().optional(),
});

export const closeFiscalYearSchema = z.object({
  yearEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة تاريخ نهاية السنة غير صحيحة"),
  closeAccountId: z.string().min(1).nullable().optional(),
});

/** الشركة من نفس المستأجر وفي نطاق المستخدم — قبل أي قفل صف أو كتابة. */
async function companyFor(req: Parameters<RequestHandler>[0]) {
  const company = await prisma.company.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  assertCompanyAccess(req.auth!, company.id);
  return company.id;
}

export const getFiscalYears: RequestHandler = async (req, res) => {
  res.json(await service.getFiscalYearOverview(req.auth!.tenantId, await companyFor(req)));
};

export const updateFiscalYearSettings: RequestHandler = async (req, res) => {
  res.json(await service.updateFiscalYearSettings(req.auth!.tenantId, await companyFor(req), req.body));
};

export const closeFiscalYear: RequestHandler = async (req, res) => {
  res.json(await service.closeFiscalYear(req.auth!.tenantId, await companyFor(req), req.auth!.sub, req.body));
};

export const reopenLastFiscalYear: RequestHandler = async (req, res) => {
  res.json(await service.reopenLastFiscalYear(req.auth!.tenantId, await companyFor(req), req.auth!.sub));
};
