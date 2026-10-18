import type { Request, RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { currentRequestContext, SAFE_METHODS } from "../lib/requestContext";
import { attachmentEntityCompanyId } from "../lib/subscriptionWriteGuard";
import {
  companySuspendedError,
  assertEnforcedCompanyWritable,
  assertEnforcedModuleWritable,
  assertPosSeat,
  enforcedCompany,
  suspendedCompanyIds,
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
  // مسارات :id فيها هو الشركة نفسها: موجّه الشركات (/api/companies/:id/…) وربط زاتكا (/api/companies/:id/zatca/…) — طلب CSID
  // يذهب لزاتكا قبل أي كتابة، فيجب أن يُرفَض هنا. بقية الموجّهات تحت /api/companies تستخدم :companyId المقروء أعلاه.
  if (isCompanyIdRoute(req)) add(req.params?.id);
  return [...ids];
}

const COMPANY_ROUTER_BASE = "/api/companies";
const ZATCA_ROUTER_BASE = /^\/api\/companies\/[^/]+\/(?:zatca|qoyod)$/;
function isCompanyIdRoute(req: Request): boolean {
  return req.baseUrl === COMPANY_ROUTER_BASE || ZATCA_ROUTER_BASE.test(req.baseUrl);
}

/**
 * وحدات "ميزة" لا "بيانات قائمة": سؤال أثر AI يستدعي نموذجاً مدفوعاً ويُنتج محتوى جديداً، فلا يدخل في استثناء القراءة (D31) —
 * يخضع لحد الباقة وللعرض فقط حتى بصلاحية read (كما يرفضه #157 لعضوية "عرض فقط" اليوم).
 */
export const FEATURE_MODULES = new Set(["ai"]);

/**
 * جداول السجل التي يشير إليها :id في مسارات الكتابة لكل وحدة — لمستخدم بنطاق "all" لا يحمل طلبه companyId. تشمل كل مسار
 * يرسل لزاتكا أو يرسل بريداً قبل أن يكتب (المستندات، عقود الإيواء)، فيُرفَض قبل النداء الخارجي. المعرّفات cuid فريدة عالمياً، فتجربة
 * جدول لا يخصّ المسار لا تجد شيئاً بلا ضرر.
 */
export const RECORD_TABLES: Record<string, string[]> = {
  salesInvoices: ["salesInvoice", "quotation", "ridingLesson"],
  customers: ["customer"],
  salesReturns: ["salesReturn"],
  salesDebitNotes: ["salesDebitNote"],
  quotations: ["quotation"],
  journalEntries: ["journalEntry"],
  receipts: ["receipt"],
  purchaseInvoices: ["purchaseInvoice"],
  purchaseReturns: ["purchaseReturn"],
  payrollRuns: ["payrollRun"],
  stables: ["boardingContract", "ridingLesson"],
  // مسارات مراجعة الورديات وترحيلها (requireActionPermission → stationShiftsReports): الترحيل يقرأ حسابات الشركة قبل أي كتابة
  stationShiftsReports: ["stationShift"],
};

type CompanyLookup = { findFirst(args: { where: { id: string; tenantId: string }; select: { companyId: true } }): Promise<{ companyId: string } | null> };

/**
 * المرفقات (مراجعة #163): الشركة مشفّرة في entityType/entityId (الرفع)، أو في صف المرفق المخزَّن (الحذف /attachments/:id). المعالج
 * يرفع الملف إلى التخزين أو يحذفه منه قبل كتابة قاعدة البيانات، فيجب أن يُرفَض الطلب هنا — قبل أي عملية تخزين: لا ملف يتيم عند
 * الرفع، ولا ملف محذوف بلا رجعة عند الحذف. جسم الرفع multipart يُقرأ بعد multer، فيُعاد الفحص في validateBody (بالدالة نفسها).
 */
async function attachmentRequestCompanyId(req: Request): Promise<string | null> {
  if (!req.auth) return null;
  const id = req.params?.id;
  if (typeof id === "string" && id) {
    const row = await prisma.attachment.findFirst({ where: { id, tenantId: req.auth.tenantId }, select: { entityType: true, entityId: true } });
    return row ? attachmentEntityCompanyId(prisma, row.entityType, row.entityId) : null;
  }
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  return attachmentEntityCompanyId(prisma, body.entityType, body.entityId);
}

export async function recordCompanyId(req: Request, resourceId: string): Promise<string | null> {
  if (resourceId === "attachments") return attachmentRequestCompanyId(req);
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
  // مسار بصلاحية قراءة فقط ولو بفعل POST (معاينة استيراد، اقتراح مرآة) قراءةٌ: لا فحص اشتراك مسبق، وأي كتابة فعلية فيه يلتقطها حارس
  // الكتابة — إلا التعليق: شركة معلّقة لا تُقرأ أيضاً (§6)
  const isRead = !FEATURE_MODULES.has(resourceId) && (action === "read" || SAFE_METHODS.has(req.method));
  const suspended = await suspendedCompanyIds(req.auth.tenantId);
  if (isRead && suspended.size === 0) return;

  const ids = new Set(explicitRequestCompanyIds(req));
  const fromRecord = await recordCompanyId(req, resourceId);
  if (fromRecord) ids.add(fromRecord);
  for (const companyId of ids) if (suspended.has(companyId)) throw companySuspendedError(companyId);
  if (isRead) return;
  // سؤال AI على مستوى المستأجر (بلا شركة): يُفحَص على كل شركاته، فلا تُتجاوز شركة مُنفَّذة بترك companyId فارغاً
  if (ids.size === 0 && FEATURE_MODULES.has(resourceId)) {
    for (const c of await prisma.company.findMany({ where: { tenantId: req.auth.tenantId }, select: { id: true } })) ids.add(c.id);
  }
  for (const companyId of ids) {
    const company = await enforcedCompany(companyId);
    if (!company || company.tenantId !== req.auth.tenantId) continue;
    assertEnforcedCompanyWritable(company);
    assertEnforcedModuleWritable(company, resourceId);
    if (resourceId === "pos") await assertPosSeat(company, req.auth.sub);
  }
}

/**
 * وحدة الباقة لكل مسار كتابة غير محروس بـrequirePositionAction (مراجعة #164) — المسارات المحروسة بـrequireActionPermission
 * (معرّفات PLATFORM_ACTIONS ليست معرّفات باقة) ومسارات بوابة الموظف. كل معرّف هنا معرّف باقة من subscriptionPlans.ts:
 *  - الإجازات (طلب، تعديل، موافقة، رفض، حذف — من شاشة الموارد البشرية أو بوابة الموظف): "الإجازات تبقى في المؤسسية" (§2) —
 *    leaveSettlements معرّف الإجازات في المؤسسية، ولا تفتحه أي إضافة. ليس employees، فإضافة المحطات تفتح employees لعمّالها فقط.
 *  - ورديات المحطات (مراجعة واعتماد وترحيل من شاشة المحاسب، وتشغيل الوردية من بوابة العامل): إضافة المحطات (§2: "station-worker
 *    portal routes") — stationShiftsReports معرّف شاشة الورديات فيها.
 *  - الحضور والانصراف من البوابة: attendance (المؤسسية).
 * اختبار التغطية (subscriptionWriteRoutes.coverage.test.ts) يمرّ على كل مسار كتابة في التطبيق ويفشل لأي مسار بلا وحدة ولا إعفاء.
 */
export const ACTION_PERMISSION_PLAN_MODULES: Record<string, string> = {
  leaveRequests: "leaveSettlements",
  stationShifts: "stationShiftsReports",
};
export const PORTAL_PLAN_MODULES = {
  attendance: "attendance",
  leaveRequests: "leaveSettlements",
  stationShifts: "stationShiftsReports",
} as const;

/**
 * يُستدعى من requireActionPermission قبل فحص المستوى والمالك (الباقة ليست صلاحية): يسجّل وحدة الباقة لحارس الكتابة ويفحص مسبقاً كما
 * يفعل requirePositionAction. القراءة (فعل GET) لا تُسجَّل ولا تُرفَض — بعض حُرّاس الورديات يحمون GET أيضاً.
 */
export async function enforceActionPermissionPlan(req: Request, moduleId: string) {
  const planModule = ACTION_PERMISSION_PLAN_MODULES[moduleId];
  if (!planModule) throw new Error(`No plan module for action permission module: ${moduleId}`);
  if (SAFE_METHODS.has(req.method)) return enforceRouteSubscription(req, planModule, "read");
  currentRequestContext()?.writeResources.add(planModule);
  await enforceRouteSubscription(req, planModule, "write");
}

/**
 * وحدة الباقة لمسارات بوابة الموظف — بعد authenticateEmployeePortal (الذي يفحص "عرض فقط" والتعليق). كتابة في وحدة خارج باقة شركة
 * الموظف مرفوضة؛ وتُسجَّل الوحدة فيلتقط حارس الكتابة أي كتابة تصل إلى شركة أخرى. القراءة تمرّ.
 */
export function requirePortalPlanModule(moduleId: (typeof PORTAL_PLAN_MODULES)[keyof typeof PORTAL_PLAN_MODULES]): RequestHandler {
  const middleware: RequestHandler = async (req, _res, next) => {
    const ctx = currentRequestContext();
    if (ctx && !SAFE_METHODS.has(req.method)) {
      ctx.writeResources.add(moduleId);
      if (ctx.employeeCompanyId && (await tenantHasEnforcedCompany(ctx.tenantId))) {
        const company = await enforcedCompany(ctx.employeeCompanyId);
        if (company && company.tenantId === ctx.tenantId) assertEnforcedModuleWritable(company, moduleId);
      }
    }
    next();
  };
  // وسم وصفي يقرؤه اختبار تغطية مسارات الكتابة
  return Object.assign(middleware, { planModule: moduleId });
}

/**
 * بوابة الموظف (مراجعة #164): لا requirePositionAction فيها، فيُفحَص الطلب هنا عند المصادقة على شركة الموظف نفسه — قبل أي معالج
 * (ورفع صور القراءات والمصروفات). شركة مُنفَّذة "عرض فقط" أو معلّقة: الكتابة (فعل غير GET) مرفوضة، والقراءة تمرّ. حارس الكتابة
 * خلفها يلتقط أي كتابة تصل إلى شركة أخرى. شركة بلا صف مُنفَّذ أو المفتاح معطّل: لا أثر.
 */
export async function enforcePortalSubscription(tenantId: string, companyId: string, method: string) {
  if (SAFE_METHODS.has(method) || !(await tenantHasEnforcedCompany(tenantId))) return;
  const company = await enforcedCompany(companyId);
  if (company && company.tenantId === tenantId) assertEnforcedCompanyWritable(company);
}

/**
 * مسارات رفع الملفات (multipart) يحلّل multer جسمها بعد requirePositionAction، فلا يرى الفحص المسبق companyId الذي في النموذج. يُعاد
 * الفحص هنا من validateBody بعد التحليل وقبل المعالج (استخراج القيود والعملاء وبيانات الشركة يستدعي نموذج Claude الخارجي).
 */
export async function recheckRouteSubscriptionAfterBody(req: Request, writeResources: Iterable<string>) {
  for (const resourceId of writeResources) await enforceRouteSubscription(req, resourceId, "create");
}
