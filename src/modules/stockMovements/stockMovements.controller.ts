import { RequestHandler } from "express";
import * as service from "./stockMovements.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, itemId } = req.query;
  const movements = await service.listStockMovements(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    itemId: typeof itemId === "string" ? itemId : undefined,
  });
  res.json(movements);
};

const parseDate = (v: unknown) => (typeof v === "string" && v ? new Date(v) : undefined);
const parseCompanyId = (v: unknown) => (typeof v === "string" && v ? v : undefined);

// كرت صنف للقراءة فقط — راجع service.getItemCard لتفاصيل الرصيد المتحرك/حلّ المستند المصدر.
// assertRecordCompanyScope هنا (لا فقط تمرير companyId من الاستعلام لدالة الخدمة) يمنع مستخدماً
// بصلاحية محدودة على شركة معيّنة من الاطّلاع على كرت صنف شركة أخرى بمجرد تخمين itemId، حتى لو
// أرسل companyId مختلفاً في الاستعلام (نفس نمط balanceHandler أعلاه بالضبط).
export const itemCardHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.item, req.params.itemId);
  const result = await service.getItemCard(req.auth!.tenantId, req.params.itemId, {
    companyId: parseCompanyId(req.query.companyId),
    dateFrom: parseDate(req.query.from),
    dateTo: parseDate(req.query.to),
  });
  res.json(result);
};

export const balanceHandler: RequestHandler = async (req, res) => {
  const { itemId, warehouseId } = req.query;
  if (typeof itemId !== "string" || typeof warehouseId !== "string") {
    res.status(400).json({ error: "itemId و warehouseId مطلوبان" });
    return;
  }
  await assertRecordCompanyScope(req.auth!, prisma.item, itemId);
  await assertRecordCompanyScope(req.auth!, prisma.warehouse, warehouseId);
  const balance = await service.getStockBalance(req.auth!.tenantId, itemId, warehouseId);
  res.json({ balance });
};

export const createInOutHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createInOutMovement(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const createIssueHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createIssueMovement(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const createTransferHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createTransferMovement(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const removeHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.stockMovement, req.params.id);
  await service.removeStockMovement(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin);
  res.status(204).send();
};
