import { RequestHandler } from "express";
import { parseVatPeriod } from "../../lib/vatPeriod";
import { getVatReconciliation } from "./vatReconciliation.service";
import { getVatReturn } from "./vatReturn.service";

export const vatReconciliationHandler: RequestHandler = async (req, res) => {
  res.json(await getVatReconciliation(req.auth!.tenantId, await parseVatPeriod(req.auth!.tenantId, req.query)));
};

export const vatReturnHandler: RequestHandler = async (req, res) => {
  res.json(await getVatReturn(req.auth!.tenantId, await parseVatPeriod(req.auth!.tenantId, req.query)));
};
