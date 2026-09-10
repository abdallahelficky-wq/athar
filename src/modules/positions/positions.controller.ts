import { RequestHandler } from "express";
import * as service from "./positions.service";

export const listHandler: RequestHandler = async (req, res) => {
  res.json(await service.listPositions(req.auth!.tenantId));
};

export const listAssignableUsersHandler: RequestHandler = async (req, res) => {
  res.json(await service.listAssignableUsers(req.auth!.tenantId));
};

export const createHandler: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(await service.createPosition(req.auth!.tenantId, req.body.name, req.body.allowUnpost, req.body.allowPosDeferredSale));
};

export const updateHandler: RequestHandler = async (req, res) => {
  res.json(await service.updatePositionPermissions(req.auth!.tenantId, req.params.id, req.body));
};

export const updateActionPermissionHandler: RequestHandler = async (req, res) => {
  res.json(
    await service.updatePositionActionPermission(req.auth!.tenantId, req.params.id, req.body.moduleId, req.body.actionId, req.body.level),
  );
};

export const listUserOverridesHandler: RequestHandler = async (req, res) => {
  res.json(await service.listUserOverrides(req.auth!.tenantId));
};

export const upsertUserOverrideHandler: RequestHandler = async (req, res) => {
  res.json(await service.upsertUserOverride(req.auth!.tenantId, req.body));
};

export const deleteUserOverrideHandler: RequestHandler = async (req, res) => {
  await service.deleteUserOverride(req.auth!.tenantId, req.params.overrideId);
  res.status(204).send();
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await service.deletePosition(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const assignMemberHandler: RequestHandler = async (req, res) => {
  res.json(await service.assignMember(req.auth!.tenantId, req.params.id, req.body.userId));
};

export const removeMemberHandler: RequestHandler = async (req, res) => {
  res.json(await service.removeMember(req.auth!.tenantId, req.params.id, req.params.userId));
};
