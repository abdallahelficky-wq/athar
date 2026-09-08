import { RequestHandler } from "express";
import * as service from "./periodicSettlement.service";

export const listCandidates: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  if (typeof companyId !== "string" || !companyId) {
    res.status(400).json({ message: "companyId مطلوب" });
    return;
  }
  const rows = await service.listSettlementCandidates(req.auth!.tenantId, companyId);
  res.json(rows);
};

export const createSettlement: RequestHandler = async (req, res) => {
  const { companyId, date, lines } = req.body;
  const results = await service.createSettlement(req.auth!.tenantId, req.auth!.sub, companyId, date, lines);
  res.status(201).json(results);
};
