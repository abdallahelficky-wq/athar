import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate, assertCompanyAccess, requireTenantOwner, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { badRequest, notFound, conflict } from "../../lib/httpError";
import { encryptSecret, decryptSecret } from "../../lib/zatca/secretBox";
import { qoyodRequest } from "./client";

// First rollout is explicitly authorized for Armi only. No global or tenant-wide credentials.
export const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const ids = z.record(z.string().min(1).max(100), z.number().int().positive().max(2147483647));
const schema = z.object({ apiKey: z.string().trim().min(8).max(1000).optional(), enabled: z.boolean(), mapping: z.object({ accounts: ids, contacts: ids }) });
export const qoyodRoutes = Router({ mergeParams: true });
qoyodRoutes.use(authenticate, requireTenantOwner, blockMutationsWhenReadOnly, async (req, _res, next) => {
  assertCompanyAccess(req.auth!, (req.params as Record<string, string>).id);
  const company = await prisma.company.findFirst({ where: { id: (req.params as Record<string, string>).id, tenantId: req.auth!.tenantId }, select: { id: true } });
  if (!company || company.id !== ARMI_COMPANY_ID) throw notFound();
  next();
});

qoyodRoutes.get("/", async (req, res) => {
  const companyId = (req.params as Record<string, string>).id;
  const [connection, accounts, customers, suppliers, exports] = await Promise.all([
    prisma.qoyodConnection.findUnique({ where: { companyId }, select: { enabled: true, mapping: true } }),
    prisma.account.findMany({ where: { tenantId: req.auth!.tenantId, companyId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.customer.findMany({ where: { tenantId: req.auth!.tenantId, companyId }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { tenantId: req.auth!.tenantId, companyId }, select: { id: true, name: true } }),
    prisma.qoyodJournalExport.findMany({ where: { companyId }, take: 100, orderBy: { createdAt: "desc" }, select: { entryId: true, status: true, remoteId: true, error: true, updatedAt: true, entry: { select: { entryNumber: true } } } }),
  ]);
  res.json({ configured: Boolean(connection), enabled: connection?.enabled ?? false, mapping: connection?.mapping ?? { accounts: {}, contacts: {} }, accounts, customers, suppliers, exports });
});

qoyodRoutes.get("/directory", async (req, res) => {
  const connection = await prisma.qoyodConnection.findUnique({ where: { companyId: (req.params as Record<string, string>).id } });
  if (!connection) throw badRequest("احفظ مفتاح الربط أولًا مع إبقاء الإرسال غير مفعّل");
  const key = decryptSecret(connection.apiKeyEnc);
  const accounts = await qoyodRequest(key, "accounts");
  const customers = await qoyodRequest(key, "customers");
  const vendors = await qoyodRequest(key, "vendors");
  if (!Array.isArray(accounts.accounts) || !Array.isArray(customers.customers) || !Array.isArray(vendors.vendors)) throw badRequest("تعذر قراءة دليل قيود");
  res.json({ accounts: accounts.accounts.map((a: { id: number; code: string; name_ar: string; name_en: string }) => ({ id: a.id, code: a.code, name: a.name_ar || a.name_en })),
    customer: customers.customers.map((a: { id: number; name: string }) => ({ id: a.id, name: a.name })),
    supplier: vendors.vendors.map((a: { id: number; name: string }) => ({ id: a.id, name: a.name })) });
});

qoyodRoutes.put("/", validateBody(schema), async (req, res) => {
  const companyId = (req.params as Record<string, string>).id, input = schema.parse(req.body);
  const existing = await prisma.qoyodConnection.findUnique({ where: { companyId } });
  if (!existing && !input.apiKey) throw badRequest("أدخل مفتاح الربط الخاص بأرمي في قيود");
  const key = input.apiKey || decryptSecret(existing!.apiKeyEnc);
  // Read only remote verification; never create accounts or contacts automatically.
  const remote = await qoyodRequest(key, "accounts");
  if (!Array.isArray(remote?.accounts)) throw badRequest("تعذر التحقق من حسابات قيود");
  const localAccounts = await prisma.account.findMany({ where: { companyId, tenantId: req.auth!.tenantId }, select: { id: true } });
  for (const [id, target] of Object.entries(input.mapping.accounts)) {
    if (!localAccounts.some(a => a.id === id) || !remote.accounts.some((a: { id: number }) => a.id === target)) throw badRequest("مطابقة حساب غير صحيحة");
  }
  if (input.enabled && !Object.keys(input.mapping.accounts).length) throw badRequest("اربط الحسابات قبل تفعيل الإرسال");
  for (const kind of ["customer", "supplier"] as const) {
    const entries = Object.entries(input.mapping.contacts).filter(([id]) => id.startsWith(`${kind}:`));
    if (!entries.length) continue;
    const local = kind === "customer" ? await prisma.customer.findMany({ where: { companyId }, select: { id: true } }) : await prisma.supplier.findMany({ where: { companyId }, select: { id: true } });
    const resource = kind === "customer" ? "customers" : "vendors";
    const response = await qoyodRequest(key, resource);
    if (!Array.isArray(response?.[resource])) throw badRequest("تعذر التحقق من أطراف قيود");
    for (const [id, target] of entries) if (!local.some(a => `${kind}:${a.id}` === id) || !response[resource].some((a: { id: number }) => a.id === target)) throw badRequest("مطابقة طرف غير صحيحة");
  }
  if (Object.keys(input.mapping.contacts).some(id => !/^(customer|supplier):/.test(id))) throw badRequest("نوع طرف غير صالح");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "companyId" FROM qoyod_connections WHERE "companyId"=${companyId} FOR UPDATE`;
    if (input.apiKey && await tx.qoyodJournalExport.count({ where: { companyId } })) throw conflict("لا يمكن تغيير مفتاح الوجهة بعد بدء الربط؛ احتفظ بالمفتاح الحالي");
    await tx.qoyodConnection.upsert({ where: { companyId }, create: { companyId, apiKeyEnc: encryptSecret(key), enabled: input.enabled, mapping: input.mapping }, update: { ...(input.apiKey ? { apiKeyEnc: encryptSecret(key) } : {}), enabled: input.enabled, mapping: input.mapping, updatedAt: new Date() } });
    await tx.auditLog.create({ data: { tenantId: req.auth!.tenantId, companyId, userId: req.auth!.sub, action: "qoyod.settings_updated", entityType: "Company", entityId: companyId, metadata: { enabled: input.enabled, accountMappings: Object.keys(input.mapping.accounts).length } } });
  });
  res.json({ saved: true });
});

qoyodRoutes.post("/retry/:entryId", async (req, res) => {
  const result = await prisma.qoyodJournalExport.updateMany({ where: { entryId: req.params.entryId, companyId: (req.params as Record<string, string>).id, status: "blocked" }, data: { status: "queued", error: null, updatedAt: new Date() } });
  if (!result.count) throw conflict("إعادة المحاولة متاحة للفشل المؤكد فقط؛ الحالات غير المؤكدة تحتاج مراجعة");
  res.json({ queued: true });
});
