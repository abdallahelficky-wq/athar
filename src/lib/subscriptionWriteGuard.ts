import { Prisma, type PrismaClient } from "@prisma/client";
import { currentRequestContext, SAFE_METHODS } from "./requestContext";
import { assertRequestMayWrite, enforcedCompany, stationWorkersOnlyError, tenantHasEnforcedCompany } from "./subscriptionEnforcement";

/**
 * حارس الكتابة في طبقة البيانات (P4، §5.4) — شبكة الأمان خلف الفحص المسبق على المسار. أي كتابة (create/update/delete…) في بيانات
 * شركة — جدول يحمل companyId، أو جدول تُحلّ شركته عبر أصله (انظر الجرد أدناه) — أثناء طلب مستخدم أو موظف البوابة بفعل غير GET، في
 * شركة مُنفَّذة، تُفحَص: الشركة "عرض فقط" أو معلّقة → رفض؛ الطلب يكتب في وحدة
 * خارج باقتها → رفض. الرفض داخل المعاملة يُرجعها كاملة.
 *
 * لماذا هنا لا في المسار وحده: كثير من المسارات تعدّل سجلاً بمعرّفه بلا companyId في الطلب، وقيد المرآة يُكتب في شركة غير شركة
 * الطلب، وعكس قيد مرآة يمسّ الشركتين — كلها تصل في النهاية إلى كتابة صف بـcompanyId الشركة الحقيقية.
 *
 * بلا أي كلفة حين: لا طلب مستخدم ولا طلب بوابة موظف (المُجدوِلات، لوحة مدير المنصة)، أو فعل GET، أو المفتاح الشامل معطّل، أو مستأجر
 * الطلب بلا أي شركة مُنفَّذة.
 */

const WRITE_ACTIONS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/** جداول تُكتب جانبياً أثناء القراءة أو تخص إدارة الاشتراك نفسها — لا تُمنَع */
const EXEMPT_MODELS = new Set(["AuditLog", "CompanySubscription", "SubscriptionEvent", "SubscriptionReminder", "CompanyPosUser", "PlatformSetting"]);

const COMPANY_MODELS = new Set([
  // صف الشركة نفسه (إعداداتها، بياناتها القانونية): الكتابة فيه كتابة في تلك الشركة — معرّفه هو companyId
  "Company",
  ...Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "companyId" && f.kind === "scalar")).map((m) => m.name),
]);

/**
 * جرد كل جدول بلا عمود companyId (مراجعة #164) — ثلاثة أصناف، واختبار التغطية (subscriptionWriteGuard.test.ts) يفشل لأي جدول
 * جديد لا يقع في أحدها، فلا يتسلّل جدول شركة من الحارس:
 *
 * (أ) PARENT_MODELS: شركته عبر علاقة أصل (المسار: مفتاح ← جدول الأصل). يحلّها الحارس من الصف نفسه أو من data، ثم شركة الأصل —
 *     بشكل متكرر حين يكون الأصل نفسه بلا companyId. أصلٌ أُنشئ للتوّ داخل معاملة الطلب نفسها لا يُرى من خارجها، فيُتخطّى بلا فحص:
 *     ذلك الأصل نفسه كُتب في هذا الطلب ومرّ بالحارس (الصنف ج).
 * (ب) TENANT_LEVEL_MODELS: على مستوى المستأجر أو المنصة، لا يخص شركة بعينها — معفى، والسبب مكتوب لكل جدول.
 * (ج) "يُكتب مع أصل محروس في الطلب نفسه" لا يحتاج قائمة: الكتابة المتداخلة (lines: { create: [...] }) لا تمرّ بهذا الحارس منفصلةً
 *     أصلاً، بل ضمن كتابة الأصل المحروسة؛ وكل كتابة منفصلة لجدول من (أ) تُحلّ عبر أصلها.
 */
export const PARENT_MODELS: Record<string, { fk: string; relation: string; parent: string }> = {
  JournalEntryLine: { fk: "journalEntryId", relation: "journalEntry", parent: "JournalEntry" },
  InvoiceEmailLog: { fk: "invoiceId", relation: "invoice", parent: "SalesInvoice" },
  SalesInvoiceLine: { fk: "invoiceId", relation: "invoice", parent: "SalesInvoice" },
  SalesReturnLine: { fk: "returnId", relation: "salesReturn", parent: "SalesReturn" },
  SalesDebitNoteLine: { fk: "debitNoteId", relation: "salesDebitNote", parent: "SalesDebitNote" },
  ReceiptAllocation: { fk: "receiptId", relation: "receipt", parent: "Receipt" },
  PurchaseInvoiceLine: { fk: "invoiceId", relation: "invoice", parent: "PurchaseInvoice" },
  PurchaseReturnLine: { fk: "returnId", relation: "purchaseReturn", parent: "PurchaseReturn" },
  ItemComponent: { fk: "parentItemId", relation: "parentItem", parent: "Item" },
  EmployeeDocument: { fk: "employeeId", relation: "employee", parent: "Employee" },
  LeaveRequest: { fk: "employeeId", relation: "employee", parent: "Employee" },
  LeaveSettlement: { fk: "employeeId", relation: "employee", parent: "Employee" },
  EmployeePayrollComponent: { fk: "employeeId", relation: "employee", parent: "Employee" },
  EmployeeAdvanceDeduction: { fk: "employeeAdvanceId", relation: "employeeAdvance", parent: "EmployeeAdvance" },
  HrAction: { fk: "employeeId", relation: "employee", parent: "Employee" },
  HorseBoardingInvoiceLine: { fk: "boardingInvoiceId", relation: "boardingInvoice", parent: "HorseBoardingInvoice" },
};

/**
 * (أ) متعدد الأشكال: المرفق يشير إلى سجله بـentityType/entityId لا بعلاقة. نفس خريطة الأنواع التي يتحقق بها مسار المرفقات من نطاق
 * الشركة (attachments.controller.ts) — اختبار التغطية يطابقها مع attachmentEntityTypeEnum.
 */
export const ATTACHMENT_ENTITY_MODELS: Record<string, string> = {
  company: "Company",
  customer: "Customer",
  journal_entry: "JournalEntry",
  sales_invoice: "SalesInvoice",
  sales_return: "SalesReturn",
  receipt: "Receipt",
  purchase_invoice: "PurchaseInvoice",
  purchase_return: "PurchaseReturn",
  payroll_run: "PayrollRun",
  leave_settlement: "LeaveSettlement",
  fixed_asset: "FixedAsset",
  employee: "Employee",
  station_shift_reading: "StationShiftReading",
  station_shift_expense: "StationShiftExpense",
};

/** (ب) مستوى المستأجر أو المنصة — لا شركة يُفحَص اشتراكها */
export const TENANT_LEVEL_MODELS: Record<string, string> = {
  Tenant: "المستأجر نفسه — فوق الشركات؛ \"عرض فقط\" على مستواه يبقى كما هو (D32)",
  PlatformNotice: "إشعار من لوحة مدير المنصة للمستأجر — لا يكتبه طلب مستخدم",
  Identity: "هوية الدخول (البريد/كلمة المرور) مشتركة بين كل مستأجرات الشخص",
  PasswordResetToken: "رمز استعادة كلمة المرور على الهوية — تسجيل الدخول لا يُمنَع بسبب الباقة",
  RefreshToken: "جلسة دخول — تجديد الجلسة قراءة في جوهره ولا يُمنَع بسبب الباقة",
  User: "عضوية المستأجر — حد المقاعد لكل شركة يُفرَض ذرّياً في withUserSeat عند الدعوة وإعادة التفعيل ونقل النطاق",
  UserActionPermissionOverride: "استثناء صلاحية فردي على العضوية — إعداد صلاحيات المستأجر بيد المالك",
  Position: "منصب على مستوى المستأجر — إعداد صلاحيات بيد المالك، لا بيانات شركة",
  PositionPermission: "صف صلاحيات المنصب — كالمنصب",
  PositionActionPermission: "صف صلاحيات المنصب — كالمنصب",
  JobTitle: "مسمّى وظيفي على مستوى المستأجر (شؤون الموظفين ← الوظائف)، مشترك بين شركاته",
  PortalLoginThrottle: "عدّاد محاولات دخول بوابة الموظف — حماية، يُكتب أثناء الدخول",
  PlanPrice: "كتالوج أسعار المنصة — لوحة مدير المنصة",
  PlatformSetting: "إعدادات المنصة (منها المفتاح الشامل نفسه) — لوحة مدير المنصة",
  SubscriptionEvent: "سجل أحداث الاشتراك — دفتر إدارة الاشتراك نفسه",
  SubscriptionReminder: "تذكيرات الاشتراك — دفتر إدارة الاشتراك نفسه، يكتبها المُجدوِل",
};

const delegateName = (model: string) => model[0].toLowerCase() + model.slice(1);

type Args = Record<string, unknown> | undefined;
type AnyDelegate = {
  findUnique(a: unknown): Promise<Record<string, unknown> | null>;
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
};
const delegateOf = (client: PrismaClient, model: string) => (client as unknown as Record<string, AnyDelegate>)[delegateName(model)];

/** شركة سجل بمعرّفه — مباشرة، أو عبر سلسلة الأصل (أ). null = غير موجود (أو أُنشئ للتوّ في معاملة الطلب، الصنف ج) */
async function companyOfRecord(client: PrismaClient, model: string, id: string): Promise<string | null> {
  if (model === "Company") return id;
  const parent = PARENT_MODELS[model];
  if (parent) {
    const row = await delegateOf(client, model).findUnique({ where: { id }, select: { [parent.fk]: true } });
    const parentId = row?.[parent.fk];
    return typeof parentId === "string" ? companyOfRecord(client, parent.parent, parentId) : null;
  }
  const row = await delegateOf(client, model).findUnique({ where: { id }, select: { companyId: true } });
  return typeof row?.companyId === "string" ? row.companyId : null;
}

/** المعرّف الذي تشير إليه data عبر المفتاح أو ربط العلاقة */
function idFromData(data: unknown, fk: string, relation: string): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d[fk] === "string") return d[fk] as string;
  const connect = (d[relation] as Record<string, unknown> | undefined)?.connect as Record<string, unknown> | undefined;
  return typeof connect?.id === "string" ? connect.id : null;
}

/** شركات كتابة في جدول من الصنف (أ): الأصل الذي تشير إليه data، والأصل الحالي للصفوف التي تمسّها الكتابة */
async function parentCompanyIds(client: PrismaClient, model: string, action: string, args: Args): Promise<string[]> {
  const ids = new Set<string>();
  const add = (v: string | null) => {
    if (v) ids.add(v);
  };
  const { fk, relation, parent } = PARENT_MODELS[model];
  const parentIds = new Set<string>();
  const fromData = (data: unknown) => {
    const id = idFromData(data, fk, relation);
    if (id) parentIds.add(id);
  };
  if (action === "create") fromData(args?.data);
  if (action === "createMany") for (const row of ([] as unknown[]).concat(args?.data ?? [])) fromData(row);
  if (action === "upsert") {
    fromData(args?.create);
    fromData(args?.update);
  }
  if (action === "update" || action === "updateMany") fromData(args?.data);
  const delegate = delegateOf(client, model);
  if (action === "update" || action === "upsert" || action === "delete") {
    const row = await delegate.findUnique({ where: args?.where, select: { [fk]: true } });
    if (typeof row?.[fk] === "string") parentIds.add(row[fk] as string);
  }
  if (action === "updateMany" || action === "deleteMany") {
    for (const row of await delegate.findMany({ where: args?.where, select: { [fk]: true }, distinct: [fk] })) {
      if (typeof row[fk] === "string") parentIds.add(row[fk] as string);
    }
  }
  for (const id of parentIds) add(await companyOfRecord(client, parent, id));
  return [...ids];
}

/** شركات كتابة في المرفقات: السجل الذي يشير إليه entityType/entityId */
async function attachmentCompanyIds(client: PrismaClient, action: string, args: Args): Promise<string[]> {
  const refs: { entityType?: unknown; entityId?: unknown }[] = [];
  if (action === "create") refs.push(args?.data as never);
  if (action === "createMany") refs.push(...([] as never[]).concat((args?.data ?? []) as never));
  if (action === "upsert") refs.push(args?.create as never);
  const delegate = delegateOf(client, "Attachment");
  if (action === "update" || action === "upsert" || action === "delete") {
    const row = await delegate.findUnique({ where: args?.where, select: { entityType: true, entityId: true } });
    if (row) refs.push(row);
  }
  if (action === "updateMany" || action === "deleteMany") {
    refs.push(...(await delegate.findMany({ where: args?.where, select: { entityType: true, entityId: true } })));
  }
  const ids = new Set<string>();
  for (const ref of refs) {
    const model = typeof ref?.entityType === "string" ? ATTACHMENT_ENTITY_MODELS[ref.entityType] : undefined;
    if (model && typeof ref.entityId === "string") {
      const companyId = await companyOfRecord(client, model, ref.entityId);
      if (companyId) ids.add(companyId);
    }
  }
  return [...ids];
}
type Lookup = {
  findUnique(a: unknown): Promise<{ companyId: string | null } | null>;
  findMany(a: unknown): Promise<{ companyId: string | null }[]>;
};

function companyFromData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.companyId === "string") return d.companyId;
  const connect = (d.company as Record<string, unknown> | undefined)?.connect as Record<string, unknown> | undefined;
  return typeof connect?.id === "string" ? connect.id : null;
}

async function affectedCompanyIds(client: PrismaClient, model: string, action: string, args: Args): Promise<string[]> {
  if (PARENT_MODELS[model]) return parentCompanyIds(client, model, action, args);
  if (model === "Attachment") return attachmentCompanyIds(client, action, args);
  const ids = new Set<string>();
  if (model === "Company") {
    // إنشاء شركة جديدة ليس كتابة في شركة مُنفَّذة؛ تعديل/حذف صفها كتابة فيها
    const id = (args?.where as Record<string, unknown> | undefined)?.id;
    if (action !== "create" && action !== "createMany" && typeof id === "string") ids.add(id);
    return [...ids];
  }
  const delegate = (client as unknown as Record<string, Lookup>)[delegateName(model)];
  const add = (v: string | null | undefined) => {
    if (v) ids.add(v);
  };
  if (action === "create") add(companyFromData(args?.data));
  if (action === "createMany") for (const row of ([] as unknown[]).concat(args?.data ?? [])) add(companyFromData(row));
  if (action === "upsert") add(companyFromData(args?.create));
  if (action === "update" || action === "upsert" || action === "delete") {
    // الصف كما هو قبل الكتابة — ونقله إلى شركة أخرى (data.companyId) يُفحَص أيضاً
    add((await delegate.findUnique({ where: args?.where, select: { companyId: true } }))?.companyId);
    if (action === "update") add(companyFromData(args?.data));
  }
  if (action === "updateMany" || action === "deleteMany") {
    for (const row of await delegate.findMany({ where: args?.where, select: { companyId: true }, distinct: ["companyId"] })) add(row.companyId);
    if (action === "updateMany") add(companyFromData(args?.data));
  }
  return [...ids];
}

type EmployeeLookup = {
  findUnique(a: unknown): Promise<{ companyId: string; assignedCostCenterId: string | null } | null>;
  findMany(a: unknown): Promise<{ companyId: string; assignedCostCenterId: string | null }[]>;
};

/** هل تعيّن data محطة؟ (حقل مباشر أو ربط علاقة) — undefined = لا يمسّ المحطة */
function stationInData(data: unknown): "set" | "cleared" | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  // Prisma يتجاهل الحقل الذي قيمته undefined — لا يُعدّ نزعاً للمحطة
  if (d.assignedCostCenterId !== undefined) return typeof d.assignedCostCenterId === "string" && d.assignedCostCenterId ? "set" : "cleared";
  const rel = d.assignedCostCenter as Record<string, unknown> | undefined;
  if (rel?.disconnect) return "cleared";
  if (rel?.connect) return "set";
  return undefined;
}

/**
 * D20: على باقة بلا موارد بشرية، إضافة المحطات تفتح سجلات عمّال المحطات وحدها (employeesScope = stationWorkers). كل كتابة في جدول
 * الموظفين لتلك الشركة يجب أن تبقى على عامل محطة: الإنشاء بمحطة، وتعديل/حذف عامل محطة فقط، وبلا نزع المحطة. القراءة لا تمرّ من هنا.
 */
async function assertStationWorkerWrites(client: PrismaClient, action: string, args: Args, companyIds: string[]) {
  const scoped = new Set<string>();
  for (const id of companyIds) if ((await enforcedCompany(id))?.entitlements.employeesScope === "stationWorkers") scoped.add(id);
  if (scoped.size === 0) return;
  const first = [...scoped][0];
  const employees = (client as unknown as { employee: EmployeeLookup }).employee;

  if (action === "create" || action === "createMany") {
    for (const row of ([] as unknown[]).concat(action === "create" ? args?.data : args?.data ?? [])) {
      if (scoped.has(companyFromData(row) ?? "") && stationInData(row) !== "set") throw stationWorkersOnlyError(companyFromData(row)!);
    }
    return;
  }
  if (action === "upsert" && scoped.has(companyFromData(args?.create) ?? "") && stationInData(args?.create) !== "set") throw stationWorkersOnlyError(first);
  const existing =
    action === "update" || action === "upsert" || action === "delete"
      ? [await employees.findUnique({ where: args?.where, select: { companyId: true, assignedCostCenterId: true } })].filter(Boolean)
      : await employees.findMany({ where: args?.where, select: { companyId: true, assignedCostCenterId: true } });
  for (const row of existing as { companyId: string; assignedCostCenterId: string | null }[]) {
    if (scoped.has(row.companyId) && !row.assignedCostCenterId) throw stationWorkersOnlyError(row.companyId);
  }
  const data = action === "upsert" ? args?.update : args?.data;
  if ((action === "update" || action === "updateMany" || action === "upsert") && stationInData(data) === "cleared") throw stationWorkersOnlyError(first);
}

const isGuardedModel = (model: string) => COMPANY_MODELS.has(model) || model in PARENT_MODELS || model === "Attachment";

let installed = false;

export function installSubscriptionWriteGuard(client: PrismaClient) {
  if (installed) return;
  installed = true;
  client.$use(async (params, next) => {
    if (!params.model || !WRITE_ACTIONS.has(params.action) || EXEMPT_MODELS.has(params.model) || !isGuardedModel(params.model)) return next(params);
    const ctx = currentRequestContext();
    if (!ctx || SAFE_METHODS.has(ctx.method)) return next(params);
    if (!(await tenantHasEnforcedCompany(ctx.tenantId))) return next(params);
    const companyIds = await affectedCompanyIds(client, params.model, params.action, params.args as Args);
    for (const companyId of companyIds) await assertRequestMayWrite(companyId, ctx.writeResources);
    if (params.model === "Employee") await assertStationWorkerWrites(client, params.action, params.args as Args, companyIds);
    return next(params);
  });
}

/** هل رُكِّب الحارس في هذه العملية؟ (createApp يركّبه) — اختبار وجوده يفشل لو سقط التركيب، ومنه عند نقله من $use إلى $extends */
export function isSubscriptionWriteGuardInstalled(): boolean {
  return installed;
}

/** للاختبار: الجداول التي يحرسها الحارس */
export const guardedModels = () => [...COMPANY_MODELS, ...Object.keys(PARENT_MODELS), "Attachment"].filter((m) => !EXEMPT_MODELS.has(m));

/** للاختبار: صنف كل جدول في المخطط — "company" (عمود companyId أو الشركة نفسها)، "parent" (أ)، "tenant" (ب)، أو null = غير مصنَّف */
export function modelClassification(model: string): "company" | "parent" | "attachment" | "tenant" | null {
  if (COMPANY_MODELS.has(model)) return "company";
  if (model in PARENT_MODELS) return "parent";
  if (model === "Attachment") return "attachment";
  if (model in TENANT_LEVEL_MODELS) return "tenant";
  return null;
}
