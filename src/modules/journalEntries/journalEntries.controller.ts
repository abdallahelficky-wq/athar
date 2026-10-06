import { RequestHandler } from "express";
import * as service from "./journalEntries.service";
import * as bulkImportService from "./bulkImport.service";
import { badRequest } from "../../lib/httpError";
import { previewNextEntryNumber } from "../../lib/journalPosting";
import { buildJournalVoucherPdf } from "../../lib/journalVoucherPdf";

const asString = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const asNumber = (v: unknown) => (typeof v === "string" && v !== "" ? Number(v) : undefined);
const asStatus = (v: unknown): "saved" | "posted" | undefined => (v === "saved" || v === "posted" ? v : undefined);
const asSortBy = (v: unknown): "date" | "entrySeq" | "amount" | undefined =>
  v === "date" || v === "entrySeq" || v === "amount" ? v : undefined;
const asSortDir = (v: unknown): "asc" | "desc" | undefined => (v === "asc" || v === "desc" ? v : undefined);

// فلاتر شاشة القيود/التصدير مشتركة بين listHandler وexportHandler — نفس القيم بالضبط تُقرأ من
// querystring في كليهما، فلا يمكن للتصدير أن يرى فلترة مختلفة عن الشاشة.
function readFilters(query: Record<string, unknown>) {
  const { companyId, dateFrom, dateTo, search, entryNumber, accountId, amount, amountMin, amountMax, status, sortBy, sortDir } = query;
  return {
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
    sortBy: asSortBy(sortBy),
    sortDir: asSortDir(sortDir),
  };
}

export const listHandler: RequestHandler = async (req, res) => {
  const result = await service.listJournalEntries(req.auth!.tenantId, {
    ...readFilters(req.query as Record<string, unknown>),
    cursor: asString(req.query.cursor),
    take: asNumber(req.query.take),
  });
  res.json(result);
};

// تصدير CSV كامل لكل القيود المطابقة للفلاتر الحالية (بلا أي حدّ صفحة) — نفس filters المستخدَمة في
// listHandler بالضبط، عبر readFilters المشتركة. يرمي الخادم خطأ 400 واضحاً (يُترجَم عبر errorHandler
// العادي) لو تجاوز عدد النتائج الحدّ الأقصى، بدل قطع الملف بصمت.
export const exportHandler: RequestHandler = async (req, res) => {
  const csv = await service.exportJournalEntriesCsv(req.auth!.tenantId, readFilters(req.query as Record<string, unknown>));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="journal-entries.csv"`);
  res.send(csv);
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

// تحميل مباشر لملف PDF لسند القيد — نفس آلية توليد PDF المستخدَمة أصلاً لفواتير المبيعات
// (renderHtmlToPdf عبر Puppeteer)، بلا مكتبة جديدة. Content-Disposition: attachment يجعل المتصفح
// يُنزّل الملف فوراً بدل عرض معاينة/نافذة طباعة يحتاج المستخدم يضغط "حفظ" بنفسه.
export const getPdfHandler: RequestHandler = async (req, res) => {
  const entry = await service.getJournalEntry(req.auth!.tenantId, req.params.id);
  const entryNumber = entry.entryNumber || entry.id.slice(-8);
  const hasBranchColumn = entry.lines.some((l) => l.branch);
  const pdf = await buildJournalVoucherPdf({
    entryNumber,
    date: entry.date.toISOString().slice(0, 10),
    memo: entry.memo,
    statusLabel: entry.status === "posted" ? "مرحّل" : "محفوظ",
    companyName: entry.company.shortName || entry.company.name,
    brandColor: entry.company.brandColor,
    hasBranchColumn,
    lines: entry.lines.map((l) => ({
      accountLabel: l.account.name,
      costCenterLabel: l.costCenter?.name || "—",
      departmentLabel: l.departmentRef?.name || l.department || "—",
      branchLabel: l.branch?.nameAr || null,
      description: l.description || "—",
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${entryNumber}.pdf"`);
  res.send(pdf);
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
