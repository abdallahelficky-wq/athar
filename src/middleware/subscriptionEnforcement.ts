import type { Request } from "express";
import { prisma } from "../lib/prisma";
import { SAFE_METHODS } from "../lib/requestContext";
import {
  assertEnforcedCompanyWritable,
  assertEnforcedModuleWritable,
  assertPosSeat,
  enforcedCompany,
  tenantHasEnforcedCompany,
} from "../lib/subscriptionEnforcement";

/**
 * الفحص المسبق على مستوى المسار (P4، §5.1): قبل أن يبدأ المعالج أي عمل — وقبل أي نداء خارجي لا يمكن التراجع عنه (إرسال لزاتكا،
 * بريد) — نحدّد شركة/شركات الطلب ونرفضه إن كانت مُنفَّذة وتمنع ما يطلبه. ما لا يُحدَّد هنا يلتقطه حارس الكتابة في طبقة البيانات
 * (subscriptionWriteGuard) عند أول كتابة فعلية في شركة مُنفَّذة.
 */

/** الشركات المذكورة صراحةً في الطلب، ونطاق المستخدم المقيَّد. targetCompanyId = شركة قيد المرآة المستهدفة */
export function explicitRequestCompanyIds(req: Request): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  add(req.params?.companyId);
  add((req.query as Record<string, unknown> | undefined)?.companyId);
  if (req.body && typeof req.body === "object") {
    add((req.body as Record<string, unknown>).companyId);
    add((req.body as Record<string, unknown>).targetCompanyId);
  }
  if (req.auth && req.auth.companyScope !== "all") ids.add(req.auth.companyScope);
  return [...ids];
}

/**
 * جداول السجل التي يشير إليها :id في مسارات الكتابة لكل وحدة — لمستخدم بنطاق "all" لا يحمل طلبه companyId. تشمل كل مسار
 * يرسل لزاتكا أو يرسل بريداً قبل أن يكتب (المستندات، عقود الإيواء)، فيُرفَض قبل النداء الخارجي. المعرّفات cuid فريدة عالمياً، فتجربة
 * جدول لا يخصّ المسار لا تجد شيئاً بلا ضرر.
 */
const RECORD_TABLES: Record<string, string[]> = {
  salesInvoices: ["salesInvoice", "quotation"],
  salesReturns: ["salesReturn"],
  salesDebitNotes: ["salesDebitNote"],
  quotations: ["quotation"],
  journalEntries: ["journalEntry"],
  receipts: ["receipt"],
  purchaseInvoices: ["purchaseInvoice"],
  purchaseReturns: ["purchaseReturn"],
  payrollRuns: ["payrollRun"],
  stables: ["boardingContract"],
};

type CompanyLookup = { findFirst(args: { where: { id: string; tenantId: string }; select: { companyId: true } }): Promise<{ companyId: string } | null> };

export async function recordCompanyId(req: Request, resourceId: string): Promise<string | null> {
  const id = req.params?.id;
  if (typeof id !== "string" || !req.auth) return null;
  for (const table of RECORD_TABLES[resourceId] ?? []) {
    const delegate = (prisma as unknown as Record<string, CompanyLookup>)[table];
    const row = await delegate.findFirst({ where: { id, tenantId: req.auth.tenantId }, select: { companyId: true } });
    if (row) return row.companyId;
  }
  return null;
}

/**
 * يُستدعى من requirePositionAction لكل مسار محمي بوحدة. بلا أي كلفة إضافية حين يكون المفتاح الشامل معطّلاً أو لا شركة مُنفَّذة في
 * المستأجر. لشركة مُنفَّذة: الكتابة (فعل غير GET) في شركة "عرض فقط" مرفوضة، وإجراء كتابة في وحدة خارج الباقة مرفوض، وفتح بيع نقطة
 * البيع يتطلب تعيين المستخدم. القراءة (action=read) لا تُرفَض بسبب الباقة أبداً (D31).
 */
export async function enforceRouteSubscription(req: Request, resourceId: string, action: string) {
  if (!req.auth || !(await tenantHasEnforcedCompany(req.auth.tenantId))) return;
  // مسار بصلاحية قراءة فقط ولو بفعل POST (معاينة استيراد، اقتراح مرآة) قراءةٌ: لا فحص مسبق، وأي كتابة فعلية فيه يلتقطها حارس الكتابة
  if (action === "read" || SAFE_METHODS.has(req.method)) return;

  const ids = new Set(explicitRequestCompanyIds(req));
  const fromRecord = await recordCompanyId(req, resourceId);
  if (fromRecord) ids.add(fromRecord);
  for (const companyId of ids) {
    const company = await enforcedCompany(companyId);
    if (!company || company.tenantId !== req.auth.tenantId) continue;
    assertEnforcedCompanyWritable(company);
    assertEnforcedModuleWritable(company, resourceId);
    if (resourceId === "pos") await assertPosSeat(company, req.auth.sub);
  }
}
