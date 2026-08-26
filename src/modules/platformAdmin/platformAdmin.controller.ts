import { RequestHandler } from "express";
import * as service from "./platformAdmin.service";

export const listTenantsHandler: RequestHandler = async (_req, res) => {
  res.json(await service.listTenantsForPlatform());
};

export const getTenantHandler: RequestHandler = async (req, res) => {
  res.json(await service.getTenantForPlatform(req.params.id));
};

export const updateSubscriptionHandler: RequestHandler = async (req, res) => {
  res.json(await service.updateTenantSubscription(req.params.id, req.body));
};

export const updateModulesHandler: RequestHandler = async (req, res) => {
  res.json(await service.updateTenantModules(req.params.id, req.body.enabledModules));
};

export const createNoticeHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createTenantNotice(req.params.id, req.body.message));
};

export const listNoticesHandler: RequestHandler = async (req, res) => {
  res.json(await service.listTenantNotices(req.params.id));
};

export const deleteNoticeHandler: RequestHandler = async (req, res) => {
  await service.deleteTenantNotice(req.params.id, req.params.noticeId);
  res.status(204).send();
};
