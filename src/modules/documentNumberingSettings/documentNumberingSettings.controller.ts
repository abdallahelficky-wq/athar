import { RequestHandler } from "express";
import * as service from "./documentNumberingSettings.service";
import { docTypeParamSchema } from "./documentNumberingSettings.schemas";
import { badRequest } from "../../lib/httpError";

function parseDocType(raw: string) {
  const parsed = docTypeParamSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("نوع مستند غير معروف");
  return parsed.data;
}

export const getSettingsHandler: RequestHandler = async (req, res) => {
  const docType = parseDocType(req.params.docType);
  res.json(await service.getDocumentNumberingSettings(req.auth!.tenantId, req.params.companyId, docType));
};

export const updateSettingsHandler: RequestHandler = async (req, res) => {
  const docType = parseDocType(req.params.docType);
  res.json(await service.updateDocumentNumberingSettings(req.auth!.tenantId, req.params.companyId, docType, req.body));
};
