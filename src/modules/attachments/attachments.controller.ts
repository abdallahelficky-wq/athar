import { RequestHandler } from "express";
import multer from "multer";
import * as service from "./attachments.service";
import { attachmentEntityTypeEnum } from "./attachments.schemas";
import { badRequest, notFound } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB — يكفي لصور/PDF مستندات مسحوبة ضوئياً

export const uploadSingleFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } }).single(
  "file",
);

/** نظام مرفقات متعدد الأشكال (entityType/entityId حرّان) — كل نوع كيان يُحلَّل هنا لاستخراج
 * companyId الفعلي للتحقق من enforceCompanyScope (الذي لا يغطي هذا النمط لأنه غير مرتبط مباشرة
 * بـcompanyId في الطلب). سجلّ غير موجود يُترَك بصمت لطبقة service لترمي notFound كالمعتاد. */
async function assertEntityCompanyAccess(auth: { tenantId: string; companyScope: string }, entityType: string, entityId: string) {
  if (auth.companyScope === "all") return;
  const record = await (
    {
      company: () => prisma.company.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { id: true } }).then((r) => r && { companyId: r.id }),
      customer: () => prisma.customer.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      journal_entry: () => prisma.journalEntry.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      sales_invoice: () => prisma.salesInvoice.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      sales_return: () => prisma.salesReturn.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      receipt: () => prisma.receipt.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      purchase_invoice: () => prisma.purchaseInvoice.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      purchase_return: () => prisma.purchaseReturn.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      payroll_run: () => prisma.payrollRun.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      fixed_asset: () => prisma.fixedAsset.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      employee: () => prisma.employee.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { companyId: true } }),
      leave_settlement: () =>
        prisma.leaveSettlement.findFirst({ where: { id: entityId, tenantId: auth.tenantId }, select: { employee: { select: { companyId: true } } } }).then((r) => r && { companyId: r.employee.companyId }),
    } as Record<string, () => Promise<{ companyId: string } | null | undefined>>
  )[entityType]?.();
  const resolved = await record;
  if (resolved?.companyId) assertCompanyAccess(auth, resolved.companyId);
}

export const listHandler: RequestHandler = async (req, res) => {
  const { entityType, entityId } = req.query;
  const parsedType = attachmentEntityTypeEnum.safeParse(entityType);
  if (!parsedType.success || typeof entityId !== "string" || !entityId) {
    throw badRequest("entityType و entityId مطلوبان");
  }
  await assertEntityCompanyAccess(req.auth!, parsedType.data, entityId);
  res.json(await service.listAttachments(req.auth!.tenantId, parsedType.data, entityId));
};

export const createHandler: RequestHandler = async (req, res) => {
  if (!req.file) throw badRequest("الملف مطلوب");
  await assertEntityCompanyAccess(req.auth!, req.body.entityType, req.body.entityId);

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
  const existing = await prisma.attachment.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("المرفق غير موجود");
  await assertEntityCompanyAccess(req.auth!, existing.entityType, existing.entityId);
  await service.deleteAttachment(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
