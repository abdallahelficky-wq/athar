/**
 * سكريبت قرائي فقط بالكامل — لا يُعدِّل ولا يحذف ولا يُنشئ أي شيء في قاعدة البيانات.
 *
 * الخطوة الأولى الإلزامية قبل بناء أي خريطة "نص عربي مخزَّن -> مفتاح ترجمة مستقر" (البند 2 من خطة
 * إصلاح دعم الإنجليزية، المرحلة الثانية): يستخرج القيم الفريدة الفعلية الموجودة حالياً في الإنتاج
 * لكل حقل من الحقول التي تعرض قوائمها من الثوابت الثابتة في frontend/src/legacy/constants.js
 * وhr.jsx (DEPARTMENTS, LEAVE_TYPES, ASSET_CATEGORIES, NATIONALITIES, EMPLOYEE_DOC_TYPES)، مع عدد
 * الصفوف لكل قيمة — عبر كل الشركات/المستأجرين في قاعدة البيانات بأكملها (ليس محصوراً بشركة أرمي؛
 * هذا تدقيق على مستوى المنتج كله).
 *
 * "القسم" تحديداً يُخزَّن فعلياً في عمودين منفصلين (تحقَّق من هذا بقراءة الكود قبل كتابة هذا
 * السكريبت، لا افتراضاً): Employee.department (قسم الموظف نفسه، من شاشة ملفات الموظفين) و
 * JournalEntryLine.department (القسم المُختار عند الصرف المخزني في IssueTab.jsx، يُكتَب في سطر
 * القيد التلقائي الناتج عن حركة الصرف) — كلاهما يُعرَضان هنا منفصلَين بوضوح.
 *
 * يطبع لكل حقل: كل قيمة فريدة موجودة فعلياً + عدد الصفوف، مرتَّبة تنازلياً بالعدد، مع علامة تحذير
 * صريحة على أي قيمة لا تُطابق نصياً (تطابقاً دقيقاً تاماً) أياً من عناصر القائمة الثابتة الحالية —
 * لأن هذه بالضبط الحالات (اختلاف مسافات/إملاء/قيم قديمة) التي قد تُفلِت من أي خريطة تُبنى فقط على
 * القائمة الحالية بلا مراجعة الواقع الفعلي أولاً.
 *
 * الاستخدام: DATABASE_URL=<...> npx tsx scripts/check-i18n-list-values.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// نفس القوائم الثابتة الحالية حرفياً (منسوخة هنا للمقارنة فقط، لا استيراد من كود الفرونت إند —
// هذا سكريبت باك إند مستقل تماماً). أي تغيير لاحق في تلك الملفات يجب مطابقته يدوياً هنا عند إعادة
// تشغيل هذا التدقيق مستقبلاً.
const EXPECTED = {
  "LeaveRequest.type": ["سنوية", "مرضية", "بدون راتب", "عارضة"],
  "Employee.nationality": ["سعودي", "مصري", "باكستاني", "بنغلاديشي", "هندي", "يمني", "سوداني", "فلبيني", "أخرى"],
  "FixedAsset.category": ["سيارات ومركبات", "معدات وآلات", "أثاث ومفروشات", "أجهزة حاسب وتقنية", "مباني وإنشاءات", "أخرى"],
  "EmployeeDocument.type": ["إقامة", "جواز سفر", "رخصة قيادة", "بطاقة تشغيل سائق (نقل عام)", "شهادة صحية", "تأمين طبي", "أخرى"],
  "Employee.department": [
    "الإدارة العامة", "المالية والحسابات", "التشغيل", "المبيعات والتسويق", "الموارد البشرية",
    "الصيانة والدعم الفني", "الشئون الإدارية", "الصيانة", "المحطات", "شئون الموظفين", "المبيعات",
    "الإدارة العليا", "الإدارة المالية", "العمليات", "التسويق", "خارجي", "الإدارة", "المشتريات", "الحسابات",
  ],
  "JournalEntryLine.department": [
    "الإدارة العامة", "المالية والحسابات", "التشغيل", "المبيعات والتسويق", "الموارد البشرية",
    "الصيانة والدعم الفني", "الشئون الإدارية", "الصيانة", "المحطات", "شئون الموظفين", "المبيعات",
    "الإدارة العليا", "الإدارة المالية", "العمليات", "التسويق", "خارجي", "الإدارة", "المشتريات", "الحسابات",
  ],
} as const;

function printGroup(label: string, rows: { value: string | null; count: number }[]) {
  const expected = new Set(EXPECTED[label as keyof typeof EXPECTED] || []);
  console.log(`\n=== ${label} — ${rows.length} قيمة فريدة، إجمالي الصفوف=${rows.reduce((s, r) => s + r.count, 0)} ===`);
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  for (const r of sorted) {
    const display = r.value === null ? "(NULL — بلا قيمة)" : `"${r.value}"`;
    const known = r.value !== null && expected.has(r.value);
    const flag = r.value === null ? "" : known ? "" : "  ⚠️ غير موجودة حرفياً في القائمة الثابتة الحالية";
    console.log(`  ${display}: ${r.count} صف${flag}`);
  }
  const unexpectedCount = sorted.filter((r) => r.value !== null && !expected.has(r.value)).length;
  if (unexpectedCount > 0) {
    console.log(`  ⚠️ ${unexpectedCount} قيمة/قيم مختلفة عن القائمة الثابتة الحالية — راجعها قبل بناء أي خريطة.`);
  }
}

async function run() {
  console.log(`=== استخراج القيم الفريدة الفعلية للحقول ذات القوائم الثابتة (كل الشركات، قرائي فقط) ===`);

  const leaveTypes = await prisma.leaveRequest.groupBy({ by: ["type"], _count: { _all: true } });
  printGroup(
    "LeaveRequest.type",
    leaveTypes.map((r) => ({ value: r.type, count: r._count._all })),
  );

  const nationalities = await prisma.employee.groupBy({ by: ["nationality"], _count: { _all: true } });
  printGroup(
    "Employee.nationality",
    nationalities.map((r) => ({ value: r.nationality, count: r._count._all })),
  );

  const assetCategories = await prisma.fixedAsset.groupBy({ by: ["category"], _count: { _all: true } });
  printGroup(
    "FixedAsset.category",
    assetCategories.map((r) => ({ value: r.category, count: r._count._all })),
  );

  const docTypes = await prisma.employeeDocument.groupBy({ by: ["type"], _count: { _all: true } });
  printGroup(
    "EmployeeDocument.type",
    docTypes.map((r) => ({ value: r.type, count: r._count._all })),
  );

  const employeeDepartments = await prisma.employee.groupBy({ by: ["department"], _count: { _all: true } });
  printGroup(
    "Employee.department",
    employeeDepartments.map((r) => ({ value: r.department, count: r._count._all })),
  );

  const lineDepartments = await prisma.journalEntryLine.groupBy({ by: ["department"], _count: { _all: true } });
  printGroup(
    "JournalEntryLine.department",
    lineDepartments.map((r) => ({ value: r.department, count: r._count._all })),
  );

  console.log(`\n=== انتهى — راجع كل الأسطر المعلَّمة بـ ⚠️ قبل بناء أي خريطة ترجمة ===`);
}

run()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
