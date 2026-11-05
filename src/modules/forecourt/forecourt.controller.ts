import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./forecourt.service";
import { connectionSettings, rotateControllerSecret } from "./ptsReceiver.service";
import * as commands from "./forecourtCommands.service";

const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

function requireCompany(req: Parameters<RequestHandler>[0]) {
  const companyId = q(req.query.companyId) ?? q(req.body?.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

async function assertControllerCompany(req: Parameters<RequestHandler>[0], id: string) {
  const c = await prisma.forecourtController.findFirst({ where: { id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (c) assertCompanyAccess(req.auth!, c.companyId);
}

export const listControllersHandler: RequestHandler = async (req, res) => {
  res.json(await service.listControllers(req.auth!.tenantId, requireCompany(req)));
};

export const createControllerHandler: RequestHandler = async (req, res) => {
  requireCompany(req);
  res.status(201).json(await service.createController(req.auth!.tenantId, req.body));
};

export const updateControllerHandler: RequestHandler = async (req, res) => {
  await assertControllerCompany(req, req.params.id);
  res.json(await service.updateController(req.auth!.tenantId, req.params.id, req.body));
};

export const setNozzleMapHandler: RequestHandler = async (req, res) => {
  await assertControllerCompany(req, req.params.id);
  res.json(await service.setNozzleMap(req.auth!.tenantId, req.params.id, req.body));
};

export const listTransactionsHandler: RequestHandler = async (req, res) => {
  res.json(await service.listTransactions(req.auth!.tenantId, requireCompany(req), q(req.query.controllerId)));
};

/** يولّد مفتاح توقيع جديداً للمتحكم (يُبطل السابق فوراً) ويعيده مرة واحدة مع إعدادات الربط التي تُدخَل في الجهاز. */
export const rotateSecretHandler: RequestHandler = async (req, res) => {
  await assertControllerCompany(req, req.params.id);
  res.json(await rotateControllerSecret(req.auth!.tenantId, req.params.id));
};

export const connectionSettingsHandler: RequestHandler = async (_req, res) => {
  res.json(connectionSettings());
};

export const listAlertsHandler: RequestHandler = async (req, res) => {
  res.json(await service.listAlerts(req.auth!.tenantId, requireCompany(req), q(req.query.controllerId)));
};

/** تشغيل مضخة عن بُعد (PumpAuthorize) — يعيد صف الأمر بحالته بعد رد الجهاز (confirmed/rejected/timeout/offline). */
export const authorizePumpHandler: RequestHandler = async (req, res) => {
  await assertControllerCompany(req, req.params.id);
  const { companyId: _c, ...input } = req.body;
  res.json(await commands.authorizePump(req.auth!.tenantId, req.params.id, input, req.auth!.sub ?? null));
};

export const stopPumpHandler: RequestHandler = async (req, res) => {
  await assertControllerCompany(req, req.params.id);
  res.json(await commands.stopPump(req.auth!.tenantId, req.params.id, req.body.ptsPump, Boolean(req.body.emergency), req.auth!.sub ?? null));
};

export const listCommandsHandler: RequestHandler = async (req, res) => {
  res.json(await commands.listCommands(req.auth!.tenantId, requireCompany(req), q(req.query.controllerId)));
};
