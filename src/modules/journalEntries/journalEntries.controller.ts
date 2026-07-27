import { RequestHandler } from "express";
import * as service from "./journalEntries.service";
import { badRequest } from "../../lib/httpError";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, dateFrom, dateTo, search } = req.query;
  const entries = await service.listJournalEntries(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
    dateTo: typeof dateTo === "string" ? dateTo : undefined,
    search: typeof search === "string" ? search : undefined,
  });
  res.json(entries);
};

export const getHandler: RequestHandler = async (req, res) => {
  const entry = await service.getJournalEntry(req.auth!.tenantId, req.params.id);
  res.json(entry);
};

export const createHandler: RequestHandler = async (req, res) => {
  const entry = await service.createJournalEntry(req.auth!.tenantId, req.auth!.sub, req.body);
  res.status(201).json(entry);
};

export const updateHandler: RequestHandler = async (req, res) => {
  const entry = await service.updateJournalEntry(req.auth!.tenantId, req.params.id, req.body);
  res.json(entry);
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await service.deleteJournalEntry(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  const entry = await service.postJournalEntry(req.auth!.tenantId, req.params.id);
  res.json(entry);
};

export const unpostHandler: RequestHandler = async (req, res) => {
  const entry = await service.unpostJournalEntry(req.auth!.tenantId, req.params.id, req.auth!.sub, req.body.pin);
  res.json(entry);
};

export const createFromDocumentHandler: RequestHandler = async (req, res) => {
  if (!req.file) throw badRequest("الملف مطلوب");
  const result = await service.createJournalEntryFromDocument(req.auth!.tenantId, req.auth!.sub, req.body.companyId, {
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    fileName: req.file.originalname,
  });
  res.status(201).json(result);
};

export const importHandler: RequestHandler = async (req, res) => {
  const result = await service.importJournalEntries(
    req.auth!.tenantId,
    req.auth!.sub,
    req.body.companyId,
    req.body.rows,
  );
  res.status(201).json(result);
};
