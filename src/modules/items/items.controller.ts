import { RequestHandler } from "express";
import * as itemsService from "./items.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listItems: RequestHandler = async (req, res) => {
  const { companyId, type, search } = req.query;
  const items = await itemsService.listItemsWithComputed(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    type: typeof type === "string" ? type : undefined,
    search: typeof search === "string" ? search : undefined,
  });
  res.json(items);
};

export const getItem: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.item, req.params.id);
  const item = await itemsService.getItemWithComputed(req.auth!.tenantId, req.params.id);
  res.json(item);
};

export const getItemByBarcode: RequestHandler = async (req, res) => {
  const { companyId, barcode } = req.query;
  if (typeof companyId !== "string" || typeof barcode !== "string" || !barcode.trim()) {
    res.json(null);
    return;
  }
  const item = await itemsService.findItemByBarcode(req.auth!.tenantId, companyId, barcode.trim());
  res.json(item);
};

export const createItem: RequestHandler = async (req, res) => {
  const item = await itemsService.createItemWithComponents(req.auth!.tenantId, req.body);
  res.status(201).json(item);
};

export const updateItem: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.item, req.params.id);
  const item = await itemsService.updateItemWithValidation(req.auth!.tenantId, req.params.id, req.body);
  res.json(item);
};

export const deleteItem: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.item, req.params.id);
  await itemsService.deleteItem(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const getItemComponents: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.item, req.params.id);
  const components = await itemsService.getItemComponents(req.auth!.tenantId, req.params.id);
  res.json(components);
};

export const setItemComponents: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.item, req.params.id);
  const components = await itemsService.setItemComponents(req.auth!.tenantId, req.params.id, req.body.components);
  res.json(components);
};
