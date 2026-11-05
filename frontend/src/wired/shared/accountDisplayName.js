/**
 * الاسم المعروض لحساب حسب لغة الواجهة الحالية: nameEn إن كانت اللغة إنجليزية وله قيمة غير فارغة،
 * وإلا الاسم الأساسي (العربي) دائماً — لا يُترجَم اسم مُدخَل من المستخدم أبداً، فقط يُختار الحقل
 * المناسب. نفس المنطق المستخدَم أصلاً داخل AccountSearchSelect فقط، معمَّم هنا لاستخدامه في كل
 * مكان آخر يُعرض فيه اسم حساب: شجرة الحسابات، ميزان المراجعة (شاشة/طباعة/تصدير Excel)، قائمة
 * الدخل، والمركز المالي (شاشة/طباعة).
 */
export function getAccountDisplayName(account, language) {
  return language === "en" && account?.nameEn ? account.nameEn : account?.name;
}

/**
 * اسم قسم / مركز تكلفة / وظيفة حسب لغة الواجهة: الإنجليزي حين تكون الواجهة إنجليزية وله اسم إنجليزي، وإلا العربي —
 * نفس مبدأ getAccountDisplayName. يُستخدَم للعرض فقط؛ القيمة المخزَّنة والمُرسَلة تبقى المعرّف أو الاسم العربي.
 */
export function getOrgDisplayName(entity, language) {
  return language === "en" && entity?.nameEn ? entity.nameEn : entity?.name;
}
