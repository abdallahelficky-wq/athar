import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { ACTION_PERMISSION_PLAN_MODULES, PORTAL_PLAN_MODULES } from "./subscriptionEnforcement";
import { ADDON_MODULES, planModules } from "../lib/subscriptionPlans";
import { PLATFORM_ACTIONS } from "../lib/platformActions";

/**
 * جرد كل مسار كتابة في التطبيق (مراجعة #164): كل مسار بفعل غير GET يجب أن يحمل وحدة باقة — requirePositionAction (معرّفه نفسه)،
 * أو requireActionPermission (معرّف PLATFORM_ACTIONS ← وحدة باقة عبر ACTION_PERMISSION_PLAN_MODULES)، أو وحدة بوابة الموظف
 * (requirePortalPlanModule) — وإلا فهو في قائمة الإعفاء أدناه بسببه. مسار كتابة جديد بلا وحدة ولا إعفاء يُفشل هذا الاختبار، فلا
 * يتسلّل مسار من الباقة. الإعفاء الذي لم يعد مساره موجوداً يُفشله أيضاً.
 */

/** مسارات كتابة لا تخص بيانات شركة يُفحص اشتراكها — كلٌّ بسببه */
const EXEMPT: Record<string, string> = {
  // هوية الدخول والجلسة وملف المستخدم نفسه: فوق الشركات، ولا تُمنَع بسبب الباقة
  "POST /api/auth/register": "إنشاء مستأجر جديد",
  "POST /api/auth/login": "جلسة",
  "POST /api/auth/login/complete": "جلسة",
  "POST /api/auth/switch": "جلسة (الانتقال بين العضويات)",
  "POST /api/auth/refresh": "جلسة",
  "POST /api/auth/logout": "جلسة",
  "POST /api/auth/accept-invite": "قبول دعوة صدرت — لا يُمنَع بحد المقاعد (§5.3)",
  "PATCH /api/auth/unlock-pin": "الرقم السري لفك الترحيل على مستوى المستأجر، للمالك",
  "PATCH /api/auth/me": "اسم المستخدم نفسه",
  "POST /api/auth/forgot-password": "استعادة كلمة المرور على الهوية",
  "POST /api/auth/reset-password": "استعادة كلمة المرور على الهوية",
  "POST /api/employee-portal/login": "جلسة بوابة الموظف",
  // حذف الشركة معطّل دائماً (405)
  "DELETE /api/companies/:id": "يرجع 405 دائماً — لا يكتب شيئاً",
  // المناصب والصلاحيات: إعداد صلاحيات المستأجر بيد المالك (requireTenantOwner)، لا بيانات شركة
  "POST /api/positions/": "إعداد صلاحيات المستأجر",
  "PATCH /api/positions/:id": "إعداد صلاحيات المستأجر",
  "DELETE /api/positions/:id": "إعداد صلاحيات المستأجر",
  "PUT /api/positions/:id/matrix": "إعداد صلاحيات المستأجر",
  "PATCH /api/positions/:id/action-permissions": "إعداد صلاحيات المستأجر",
  "POST /api/positions/:id/members": "إعداد صلاحيات المستأجر",
  "DELETE /api/positions/:id/members/:userId": "إعداد صلاحيات المستأجر",
  "PUT /api/positions/user-overrides": "إعداد صلاحيات المستأجر",
  "DELETE /api/positions/user-overrides/:overrideId": "إعداد صلاحيات المستأجر",
  // لوحة مدير المنصة: مفتاح خدمة المنصة، لا طلب مستأجر — منها تُدار الاشتراكات نفسها
  "PATCH /api/platform-admin/tenants/:id/subscription": "لوحة مدير المنصة",
  "PATCH /api/platform-admin/tenants/:id/modules": "لوحة مدير المنصة",
  "PATCH /api/platform-admin/tenants/:id/admin-email": "لوحة مدير المنصة",
  "DELETE /api/platform-admin/tenants/:id": "لوحة مدير المنصة",
  "POST /api/platform-admin/tenants/:id/notices": "لوحة مدير المنصة",
  "DELETE /api/platform-admin/tenants/:id/notices/:noticeId": "لوحة مدير المنصة",
  "PUT /api/platform-admin/subscription-enforcement": "لوحة مدير المنصة",
  "PUT /api/platform-admin/companies/:companyId/subscription": "لوحة مدير المنصة",
  "PUT /api/platform-admin/companies/:companyId/pos-users": "لوحة مدير المنصة",
};

type Handle = {
  name?: string;
  stack?: Layer[];
  positionAction?: { resourceId: string; action: string };
  actionPermission?: { moduleId: string };
  planModule?: string;
};
type Layer = { name?: string; regexp?: RegExp; handle: Handle; route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handle }[] } };
type WriteRoute = { key: string; modules: string[] };

const SAFE = new Set(["get", "head", "options"]);
const mountOf = (l: Layer) =>
  (l.regexp?.source ?? "")
    .replace("^\\", "")
    .replace("\\/?(?=\\/|$)", "")
    .replace(/\\\//g, "/")
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ":param");

/** وحدات الباقة التي يحملها وسيط: معرّف requirePositionAction، أو وحدة requireActionPermission، أو وحدة البوابة. null = لا وحدة */
function modulesOf(h: Handle): string[] {
  if (h.positionAction) return [h.positionAction.resourceId];
  if (h.actionPermission) return [ACTION_PERMISSION_PLAN_MODULES[h.actionPermission.moduleId] ?? `UNMAPPED:${h.actionPermission.moduleId}`];
  if (h.planModule) return [h.planModule];
  return [];
}

function writeRoutes(): WriteRoute[] {
  const out: WriteRoute[] = [];
  const walk = (stack: Layer[], prefix: string, inherited: string[]) => {
    const inh = [...inherited];
    for (const l of stack) {
      if (l.route) {
        const methods = Object.keys(l.route.methods).filter((m) => !SAFE.has(m));
        const modules = [...inh, ...l.route.stack.flatMap((s) => modulesOf(s.handle))];
        for (const m of methods) out.push({ key: `${m.toUpperCase()} ${prefix}${l.route.path}`, modules });
      } else if (l.name === "router" && l.handle.stack) {
        walk(l.handle.stack, prefix + mountOf(l), inh);
      } else {
        inh.push(...modulesOf(l.handle));
      }
    }
  };
  walk((createApp() as unknown as { _router: { stack: Layer[] } })._router.stack, "", []);
  return out;
}

const PLAN_MODULE_IDS = new Set<string>([
  ...planModules("enterprise"),
  ...Object.values(ADDON_MODULES).flat(),
]);

describe("every write route carries a plan module, or is exempt with a reason", () => {
  const routes = writeRoutes();

  it("finds the app's write routes", () => {
    expect(routes.length).toBeGreaterThan(200);
  });

  it("has a plan module on every write route that is not explicitly exempt", () => {
    const missing = routes.filter((r) => r.modules.length === 0 && !(r.key in EXEMPT)).map((r) => r.key);
    expect(missing, "مسارات كتابة بلا وحدة باقة ولا إعفاء").toEqual([]);
  });

  it("maps every requireActionPermission module to a real plan module", () => {
    for (const moduleId of Object.keys(PLATFORM_ACTIONS)) {
      expect(ACTION_PERMISSION_PLAN_MODULES[moduleId], moduleId).toBeDefined();
      expect(PLAN_MODULE_IDS.has(ACTION_PERMISSION_PLAN_MODULES[moduleId]), moduleId).toBe(true);
    }
    for (const module of Object.values(PORTAL_PLAN_MODULES)) expect(PLAN_MODULE_IDS.has(module), module).toBe(true);
    expect(routes.flatMap((r) => r.modules).filter((m) => m.startsWith("UNMAPPED:"))).toEqual([]);
  });

  it("puts leave requests in the enterprise plan only, and station shifts in the stations add-on only", () => {
    const byKey = new Map(routes.map((r) => [r.key, r.modules]));
    for (const key of ["POST /api/leave-requests/", "POST /api/leave-requests/:id/approve", "POST /api/employee-portal/leave-requests/"]) {
      expect(byKey.get(key), key).toContain("leaveSettlements");
    }
    for (const key of ["POST /api/station-shifts/:id/approve", "POST /api/station-shifts/:id/post", "POST /api/employee-portal/station-shifts/"]) {
      expect(byKey.get(key), key).toContain("stationShiftsReports");
    }
    expect(byKey.get("POST /api/attendance/check-in")).toContain("attendance");
    expect(planModules("professional").has("leaveSettlements")).toBe(false);
    expect([...ADDON_MODULES.stations]).not.toContain("leaveSettlements");
    expect(planModules("enterprise").has("stationShiftsReports")).toBe(false);
  });

  it("lists no stale exemption", () => {
    const keys = new Set(routes.map((r) => r.key));
    expect(Object.keys(EXEMPT).filter((k) => !keys.has(k))).toEqual([]);
  });
});
