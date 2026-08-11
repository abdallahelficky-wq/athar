import { RequestHandler } from "express";
import { createPosSale, getQuickAccessItems } from "./pos.service";

export const createPosSaleHandler: RequestHandler = async (req, res) => {
  const result = await createPosSale(req.auth!.tenantId, req.auth!.sub, req.body);
  res.status(201).json(result);
};

export const quickAccessItemsHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  if (typeof companyId !== "string") {
    res.json([]);
    return;
  }
  const items = await getQuickAccessItems(req.auth!.tenantId, companyId);
  res.json(items);
};
