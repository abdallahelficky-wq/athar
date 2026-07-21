import { AccountType } from "@prisma/client";

/**
 * شجرة الحسابات الافتراضية — منقولة حرفياً من الثابت ACCOUNTS في AtharAlMuhasabi.jsx
 * (المرجع الحي)، لضمان تطابق أسماء الحسابات المستخدمة في كل قيود الوحدات
 * (رواتب، إهلاك، مبيعات...) مع ما هو موثّق في القسم 4.8 و4.7 من المستند.
 * تُزرع تلقائياً لكل مستأجر جديد عند التسجيل، ويمكن للمستخدم تعديلها لاحقاً
 * عبر /api/accounts.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: { name: string; type: AccountType }[] = [
  { name: "النقدية بالصندوق", type: "asset" },
  { name: "البنك الأهلي - حساب تشغيلي", type: "asset" },
  { name: "ذمم مدينة", type: "asset" },
  { name: "ضريبة القيمة المضافة - مدخلات", type: "asset" },
  { name: "ذمم دائنة - موردين", type: "liability" },
  { name: "ضريبة القيمة المضافة - مخرجات", type: "liability" },
  { name: "مجمع الإهلاك", type: "liability" },
  { name: "رأس المال", type: "equity" },
  { name: "المبيعات - وقود", type: "revenue" },
  { name: "المبيعات - زيوت وخدمات", type: "revenue" },
  { name: "مبيعات - خدمات ومنتجات أخرى", type: "revenue" },
  { name: "مصروف إيجار", type: "expense" },
  { name: "مصروف رواتب", type: "expense" },
  { name: "مصروف تذاكر وتأشيرات الموظفين", type: "expense" },
  { name: "ذمم الموظفين - مستحقات وإجازات", type: "liability" },
  { name: "المخزون", type: "asset" },
  { name: "حساب جاري - شركات المجموعة", type: "asset" },
  { name: "تكلفة البضاعة المباعة / الصرف المخزني", type: "expense" },
  { name: "مصروف تالف ونقص المخزون", type: "expense" },
  { name: "تسويات المخزون", type: "equity" },
  { name: "مشتريات - مصروفات عامة", type: "expense" },
  { name: "مصروف رواتب أساسية", type: "expense" },
  { name: "مصروف بدل سكن", type: "expense" },
  { name: "مصروف بدل مواصلات", type: "expense" },
  { name: "مصروف بدلات أخرى", type: "expense" },
  { name: "مصروف إضافات وحوافز أخرى", type: "expense" },
  { name: "مصروف بدل إضافي (عمل إضافي)", type: "expense" },
  { name: "التأمينات الاجتماعية - مستحقة", type: "liability" },
  { name: "سلف الموظفين", type: "asset" },
  { name: "صندوق العاملين - مخالفات وعقوبات", type: "liability" },
  { name: "استقطاعات أخرى مستحقة", type: "liability" },
  { name: "رواتب مستحقة للصرف", type: "liability" },
  { name: "الأصول الثابتة", type: "asset" },
  { name: "مصروف إهلاك الأصول الثابتة", type: "expense" },
  { name: "أرباح استبعاد أصول", type: "revenue" },
  { name: "خسائر استبعاد أصول", type: "expense" },
];
