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
  // ثلاثة محاور مستقلة تماماً (لا أحدها يتضمن الآخر): "worker" لعامل المحطة الذي يفتح الوردية
  // ويُدخل القراءات/التحصيل، و"review" لاعتماد/رفض/تصحيح الوردية أثناء المراجعة، و"post" لترحيل
  // وردية مُعتمَدة فعلياً (إنشاء قيدها المحاسبي). review وpost منفصلان عمداً: نفس المستخدم يملكهما
  // معاً افتراضياً اليوم (يُمنَحان لنفس المنصب)، لكن الفصل التقني قائم من الآن ليمنح المستأجر
  // لاحقاً محاسب اعتماد ومحاسب ترحيل مختلفين بلا أي تغيير في الكود — راجع تعليق
  // stationShifts.routes.ts لتفصيل القرار.
  stationShifts: [
    { id: "worker", minLevel: "edit", label: { ar: "تشغيل وردية محطة (عامل)", en: "Operate a station shift (worker)" } },
    { id: "review", minLevel: "approve", label: { ar: "مراجعة واعتماد ورديات المحطات (محاسب)", en: "Review and approve station shifts (accountant)" } },
    { id: "post", minLevel: "approve", label: { ar: "ترحيل ورديات المحطات المُعتمَدة", en: "Post approved station shifts" } },
  ],
};
