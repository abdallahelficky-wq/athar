import { RequestHandler } from "express";
import multer from "multer";
import * as service from "./attachments.service";
import { attachmentEntityTypeEnum } from "./attachments.schemas";
import { badRequest } from "../../lib/httpError";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB — يكفي لصور/PDF مستندات مسحوبة ضوئياً

export const uploadSingleFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } }).single(
  "file",
);

export const listHandler: RequestHandler = async (req, res) => {
  const { entityType, entityId } = req.query;
  const parsedType = attachmentEntityTypeEnum.safeParse(entityType);
  if (!parsedType.success || typeof entityId !== "string" || !entityId) {
    throw badRequest("entityType و entityId مطلوبان");
  }
  res.json(await service.listAttachments(req.auth!.tenantId, parsedType.data, entityId));
};

export const createHandler: RequestHandler = async (req, res) => {
  if (!req.file) throw badRequest("الملف مطلوب");

  const attachment = await service.createAttachment(req.auth!.tenantId, req.auth!.sub, {
    entityType: req.body.entityType,
    entityId: req.body.entityId,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
  });
  res.status(201).json(attachment);
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await service.deleteAttachment(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
