// قائمة معرّفات الموديولات الرئيسية القابلة للمنح/المنع لكل شركة (Tenant) من لوحة تحكم مدير
// المنصة (athar-platform-admin) — مطابقة تماماً لمعرّفات NAV_GROUPS في frontend/src/App.jsx، حتى
// يبقى المصدران متزامنين يدوياً (أي موديول جديد يُضاف لـ NAV_GROUPS يجب إضافته هنا أيضاً).
export const PLATFORM_MODULE_IDS = [
  "sales",
  "purchases",
  "inventory",
  "stables",
  "fixedAssets",
  "accounts",
  "hr",
  "reports",
  "settings",
] as const;

export type PlatformModuleId = (typeof PLATFORM_MODULE_IDS)[number];
