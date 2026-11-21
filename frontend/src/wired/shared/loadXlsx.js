/**
 * مكتبة xlsx (SheetJS، مئات الكيلوبايت) تُحمَّل عند الحاجة فقط — عند رفع ملف أو تصديره — لا مع الحزمة الرئيسية التي
 * يحمّلها كل مستخدم عند فتح أثر. نفس نمط exceljs في تصديرات النظام (exportTrialBalanceExcel.js). الحزمة الرئيسية كانت
 * قد تجاوزت حد التخزين المسبق لعامل الخدمة (2 MiB) فيفشل البناء.
 */
let cached = null;
export function loadXlsx() {
  if (!cached) cached = import("xlsx");
  return cached;
}
