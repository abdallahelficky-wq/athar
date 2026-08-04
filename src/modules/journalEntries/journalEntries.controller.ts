import { RequestHandler } from "express";
import * as service from "./journalEntries.service";
import * as bulkImportService from "./bulkImport.service";
import { badRequest } from "../../lib/httpError";
import { previewNextEntryNumber } from "../../lib/journalPosting";

const asString = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const asNumber = (v: unknown) => (typeof v === "string" && v !== "" ? Number(v) : undefined);
const asStatus = (v: unknown) => (v === "saved" || v === "posted" ? v : undefined);

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, dateFrom, dateTo, search, entryNumber, accountId, amount, amountMin, amountMax, status } = req.query;
  const entries = await service.listJournalEntries(req.auth!.tenantId, {
    companyId: asString(companyId),
    dateFrom: asString(dateFrom),
    dateTo: asString(dateTo),
    search: asString(search),
    entryNumber: asString(entryNumber),
    accountId: asString(accountId),
    amount: asNumber(amount),
    amountMin: asNumber(amountMin),
    amountMax: asNumber(amountMax),
    status: asStatus(status),
  });
  res.json(entries);
};

export const nextNumberHandler: RequestHandler = async (req, res) => {
  if (typeof req.query.companyId !== "string" || !req.query.companyId) throw badRequest("الشركة مطلوبة");
  const result = await previewNextEntryNumber(req.auth!.tenantId, req.query.companyId);
  res.json(result);
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

export const mirrorSuggestionHandler: RequestHandler = async (req, res) => {
  const suggestion = await service.getMirrorSuggestion(req.auth!.tenantId, req.params.id, req.body.targetCompanyId);
  res.json(suggestion);
};

export const createMirrorHandler: RequestHandler = async (req, res) => {
  const mirror = await service.createMirrorJournalEntry(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body);
  res.status(201).json(mirror);
};

export const reverseHandler: RequestHandler = async (req, res) => {
  const reversal = await service.reverseJournalEntry(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.date);
  res.status(201).json(reversal);
};

export const bulkImportPreviewHandler: RequestHandler = async (req, res) => {
  const result = await bulkImportService.previewBulkImport(req.auth!.tenantId, req.body.companyId, req.body.rows);
  res.json(result);
};

export const bulkImportCommitHandler: RequestHandler = async (req, res) => {
  const result = await bulkImportService.commitBulkImport(
    req.auth!.tenantId,
    req.auth!.sub,
    req.body.companyId,
    req.body.rows,
    req.body.accountMapping,
  );
  res.status(201).json(result);
};
