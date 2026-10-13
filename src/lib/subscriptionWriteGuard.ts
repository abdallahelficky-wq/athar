import { Prisma, type PrismaClient } from "@prisma/client";
import { currentRequestContext, SAFE_METHODS } from "./requestContext";
import { assertRequestMayWrite, enforcedCompany, stationWorkersOnlyError, tenantHasEnforcedCompany } from "./subscriptionEnforcement";

/**
 * حارس الكتابة في طبقة البيانات (P4، §5.4) — شبكة الأمان خلف الفحص المسبق على المسار. أي كتابة (create/update/delete…) في جدول
 * يحمل companyId، أثناء طلب مستخدم بفعل غير GET، في شركة مُنفَّذة، تُفحَص: الشركة "عرض فقط" أو معلّقة → رفض؛ الطلب يكتب في وحدة
 * خارج باقتها → رفض. الرفض داخل المعاملة يُرجعها كاملة.
 *
 * لماذا هنا لا في المسار وحده: كثير من المسارات تعدّل سجلاً بمعرّفه بلا companyId في الطلب، وقيد المرآة يُكتب في شركة غير شركة
 * الطلب، وعكس قيد مرآة يمسّ الشركتين — كلها تصل في النهاية إلى كتابة صف بـcompanyId الشركة الحقيقية.
 *
 * بلا أي كلفة حين: لا طلب مستخدم (المُجدوِلات، بوابة الموظف، لوحة مدير المنصة)، أو فعل GET، أو المفتاح الشامل معطّل، أو مستأجر
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

const delegateName = (model: string) => model[0].toLowerCase() + model.slice(1);

type Args = Record<string, unknown> | undefined;
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

let installed = false;

export function installSubscriptionWriteGuard(client: PrismaClient) {
  if (installed) return;
  installed = true;
  client.$use(async (params, next) => {
    if (!params.model || !WRITE_ACTIONS.has(params.action) || EXEMPT_MODELS.has(params.model) || !COMPANY_MODELS.has(params.model)) return next(params);
    const ctx = currentRequestContext();
    if (!ctx || SAFE_METHODS.has(ctx.method)) return next(params);
    if (!(await tenantHasEnforcedCompany(ctx.tenantId))) return next(params);
    const companyIds = await affectedCompanyIds(client, params.model, params.action, params.args as Args);
    for (const companyId of companyIds) await assertRequestMayWrite(companyId, ctx.writeResources);
    if (params.model === "Employee") await assertStationWorkerWrites(client, params.action, params.args as Args, companyIds);
    return next(params);
  });
}

/** للاختبار: الجداول التي يحرسها الحارس */
export const guardedModels = () => [...COMPANY_MODELS].filter((m) => !EXEMPT_MODELS.has(m));
