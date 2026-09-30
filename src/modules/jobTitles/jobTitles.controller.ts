import { RequestHandler } from "express";
import * as service from "./jobTitles.service";

export const listJobTitlesHandler: RequestHandler = async (req, res) => {
  res.json(await service.listJobTitles(req.auth!.tenantId));
};

export const createJobTitleHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createJobTitle(req.auth!.tenantId, req.body.name));
};

export const renameJobTitleHandler: RequestHandler = async (req, res) => {
  res.json(await service.renameJobTitle(req.auth!.tenantId, req.params.id, req.body.name));
};

export const deleteJobTitleHandler: RequestHandler = async (req, res) => {
  await service.deleteJobTitle(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
