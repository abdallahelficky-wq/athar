// سجل الوحدات/الإجراءات المُهاجَرة فعلياً لنظام الصلاحيات الترتيبي الجديد (PositionActionPermission +
// UserActionPermissionOverride، راجع requireActionPermission في middleware/auth.ts) — بديل تدريجي
// لـ PositionPermission البوليانية، وحدة واحدة في كل مرة (بنفس فلسفة توسيع PLATFORM_MODULE_IDS
// تدريجياً). وحدة غائبة من هنا تعمل بنظام requireRole القديم بلا أي تغيير — الحضور هنا هو ما يحدّد
// "هوجرت" الوحدة أم لا، لا وجود صف في قاعدة البيانات.
//
// minLevel هنا توثيقي بحت (يوازي القيمة الفعلية المُمرَّرة يدوياً كوسيط ثالث لـ requireActionPermission
// في كل ملف routes.ts) — الاثنان يجب أن يبقيا متزامنين يدوياً عند أي تعديل، تماماً كتزامن
// PLATFORM_MODULE_IDS مع NAV_GROUPS في frontend/src/App.jsx.
export const ACTION_LEVELS = ["none", "read", "edit", "approve", "full"] as const;
export type ActionLevel = (typeof ACTION_LEVELS)[number];

export const PLATFORM_ACTIONS: Record<string, { id: string; minLevel: ActionLevel; label: { ar: string; en: string } }[]> = {
  leaveRequests: [
    { id: "view", minLevel: "read", label: { ar: "عرض الطلبات", en: "View requests" } },
    { id: "create", minLevel: "edit", label: { ar: "إنشاء طلب", en: "Create request" } },
    { id: "edit", minLevel: "edit", label: { ar: "تعديل طلب", en: "Edit request" } },
    { id: "delete", minLevel: "full", label: { ar: "حذف طلب", en: "Delete request" } },
    { id: "approve", minLevel: "approve", label: { ar: "الموافقة/الرفض", en: "Approve/Reject" } },
  ],
};
