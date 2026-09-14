/**
 * تصحيح محدود لشركة أرمي (companyId الافتراضي: cmsrciyjv000ge8f57p2azqdd) عبر الـ API الحقيقي
 * للتطبيق (تسجيل دخول ثم GET /accounts?tree=true ثم PATCH /accounts/:id) — بلا أي كتابة مباشرة
 * لقاعدة البيانات. لا يلمس أي حساب غير المذكور صراحةً أدناه بكوده.
 *
 * يعمل شيئين فقط:
 *   1) تصحيح تصنيف: الحساب بالكود "511012" — تغيير type من "asset" إلى "expense".
 *   2) تعيين nameEn لـ 48 حساباً بالكود (القائمة أدناه) — فقط للحسابات التي لا تحمل nameEn حالياً؛
 *      أي حساب من القائمة يحمل بالفعل nameEn غير فارغ يُستثنى مع تحذير صريح (يعني تغيّر شيء منذ
 *      إعداد هذه القائمة، ويحتاج مراجعة يدوية منفصلة).
 *
 * وضع افتراضي: Dry-run فقط (يعرض التغييرات المُقترَحة بلا أي تنفيذ). للتنفيذ الحقيقي مرّر --commit.
 *
 * الاستخدام:
 *   ATHAR_API_BASE="https://<production-host>/api" \
 *   ATHAR_EMAIL="..." ATHAR_PASSWORD="..." \
 *   npx tsx scripts/fix-armi-511012-type-and-english-names.ts [companyId] [--commit]
 *
 * ملاحظة أمان: هذا السكريبت لا يطبع أبداً أي قيمة من متغيرات البيئة (ATHAR_API_BASE / ATHAR_EMAIL /
 * ATHAR_PASSWORD) في أي رسالة استخدام أو خطأ أو أي مخرج آخر — يُتحقَّق فقط من وجودها (truthy) دون
 * إظهار قيمتها إطلاقاً.
 */

const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";

const apiBase = process.env.ATHAR_API_BASE;
const email = process.env.ATHAR_EMAIL;
const password = process.env.ATHAR_PASSWORD;

const TYPE_FIX: { code: string; newType: string } = { code: "511012", newType: "expense" };

const NAME_EN_UPDATES: Record<string, string> = {
  "663": "Other Miscellaneous Expenses",
  "112006": "Tismpro Company",
  "113007": "Custody - Jangeer Abu Omar",
  "113008": "Custody - Ashraf Al-Sayegh",
  "113009": "Custody - Bakr Al-Jizani",
  "113010": "Custody - Islam Ahmed",
  "113011": "Cash Custody - Alaa Eldin",
  "113012": "Cash Custody - Omran Al-Sheikh",
  "113013": "Cash with Shuaib",
  "113015": "Ashraf Marwan Al-Sayegh",
  "113016": "Faraj Mansour Faraj",
  "113017": "Sayed Bakry Abdel Azim",
  "113018": "Ola (Production Manager)",
  "113019": "Ibrahim Abdullah (Brooklyn Driver)",
  "113020": "Amir Hassan Kolaib",
  "113021": "Murad Darwish",
  "113022": "Alaa Eldin",
  "113023": "Mohamed Rostom",
  "113024": "Shuaib Riyadh",
  "113025": "Fouad Abdullah Qasim",
  "113026": "Mohamed Fayad",
  "113027": "Amer Suleiman Mohamed",
  "114007": "Vehicles Purchased",
  "114008": "Scrap Inventory",
  "121010": "Construction in Progress",
  "121011": "Office Equipment and Printers",
  "121012": "Accumulated Depreciation - Equipment",
  "341002": "Partner Current Account - Salem Balhareth",
  "341003": "Partner Current Account - Badr Al-Qarni",
  "411005": "Spare Parts Revenue",
  "411006": "Revenue from Scrap Sales",
  "511008": "Cost of Goods Sold - Scrap and Spare Parts",
  "511009": "Cost of Goods Sold - Parts",
  "511010": "Tools Expenses",
  "511011": "Transportation Expenses",
  "511012": "Oxygen Gas Expenses",
  "611007": "Employee Meal Allowance",
  "611008": "Travel Tickets",
  "611009": "Iqama Renewal and Employee Transfer Fees",
  "611010": "Employee Transportation and Housing Expenses",
  "621003": "Factory Workers' Housing Expenses",
  "622004": "Formation Expenses",
  "622005": "Hospitality Expenses",
  "622006": "Employee Fuel Expenses",
  "641002": "Employee Vehicles Maintenance",
  "641003": "General Factory Maintenance Expenses",
  "651002": "Buildings Depreciation Expense",
  "663002": "Delivery Fees",
};

interface Account {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  type: string;
}

interface PlannedChange {
  code: string;
  accountId: string;
  arabicName: string;
  fields: { field: "type" | "nameEn"; oldValue: string; newValue: string }[];
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const positional = args.filter((a) => a !== "--commit");
  const companyId = positional[0] || DEFAULT_ARMI_COMPANY_ID;

  // نتحقق فقط من الوجود (truthy) — لا نطبع القيمة نفسها في أي رسالة، حتى في مسارات الخطأ.
  if (!apiBase || !email || !password) {
    console.error("مطلوب: ATHAR_API_BASE, ATHAR_EMAIL, ATHAR_PASSWORD كمتغيرات بيئة (لن تُطبع قيمتها هنا).");
    process.exit(1);
  }

  console.log(`[${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}] الشركة: ${companyId}\n`);

  const loginRes = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.error(`فشل تسجيل الدخول (${loginRes.status}).`);
    process.exit(1);
  }
  const { accessToken } = await loginRes.json();
  const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  // tree=true إلزامي: بدونه GET /accounts يستبعد الحسابات غير النشطة/المؤرشفة وبعض المستويات
  // التجميعية — نحتاج رؤية كل حساب مذكور بكوده هنا بغض النظر عن حالته.
  const listRes = await fetch(`${apiBase}/accounts?companyId=${encodeURIComponent(companyId)}&tree=true`, { headers: auth });
  if (!listRes.ok) {
    console.error(`فشل جلب شجرة الحسابات (${listRes.status}).`);
    process.exit(1);
  }
  const allAccounts: Account[] = await listRes.json();
  const byCode = new Map<string, Account[]>();
  for (const a of allAccounts) byCode.set(a.code, [...(byCode.get(a.code) || []), a]);

  function findAccount(code: string): Account | null {
    const matches = byCode.get(code) || [];
    if (matches.length === 0) {
      console.log(`تحذير: لا يوجد حساب بالكود "${code}" في هذه الشركة — تم تجاوزه.`);
      return null;
    }
    if (matches.length > 1) {
      console.log(`تحذير: أكثر من حساب مطابق للكود "${code}" — تم تجاوزه لتفادي أي غموض. راجع يدوياً.`);
      return null;
    }
    return matches[0];
  }

  const planned = new Map<string, PlannedChange>();

  function addChange(code: string, field: "type" | "nameEn", oldValue: string, newValue: string, account: Account) {
    if (!planned.has(code)) {
      planned.set(code, { code, accountId: account.id, arabicName: account.name, fields: [] });
    }
    planned.get(code)!.fields.push({ field, oldValue, newValue });
  }

  // ---------- 1) تصحيح type للحساب 511012 ----------
  console.log(`--- 1) تصحيح التصنيف: الكود ${TYPE_FIX.code} ---`);
  const typeFixAccount = findAccount(TYPE_FIX.code);
  if (typeFixAccount) {
    console.log(`الحساب "${typeFixAccount.name}" — type الحالي: "${typeFixAccount.type}"`);
    if (typeFixAccount.type === TYPE_FIX.newType) {
      console.log(`type=${TYPE_FIX.newType} بالفعل — لا حاجة لتعديل، تم تجاوزه.`);
    } else {
      if (typeFixAccount.type !== "asset") {
        console.log(`تنبيه: type الحالي "${typeFixAccount.type}" وليس "asset" كما هو متوقَّع — سيُطبَّق التغيير المطلوب إلى "${TYPE_FIX.newType}" رغم ذلك بناءً على الكود المحدَّد صراحةً.`);
      }
      addChange(TYPE_FIX.code, "type", typeFixAccount.type, TYPE_FIX.newType, typeFixAccount);
    }
  }

  // ---------- 2) تعيين nameEn لـ 48 حساباً ----------
  console.log(`\n--- 2) تعيين nameEn لـ ${Object.keys(NAME_EN_UPDATES).length} حساباً ---`);
  let alreadySetCount = 0;
  for (const [code, newNameEn] of Object.entries(NAME_EN_UPDATES)) {
    const account = findAccount(code);
    if (!account) continue;
    const currentNameEn = account.nameEn?.trim() || "";
    if (currentNameEn) {
      console.log(`تحذير: الحساب "${code}" (${account.name}) يحمل بالفعل nameEn="${currentNameEn}" — تم تجاوزه، يحتاج مراجعة يدوية (القائمة افترضت أنه فارغ).`);
      alreadySetCount++;
      continue;
    }
    addChange(code, "nameEn", "", newNameEn, account);
  }
  console.log(`عدد الحسابات المُستثناة لأنها تحمل nameEn بالفعل: ${alreadySetCount}`);

  // ---------- جدول التغييرات المخطَّطة ----------
  console.log(`\n=== جدول التغييرات ${commit ? "المُنفَّذة" : "المخطَّطة (dry-run)"} ===`);
  console.log(["code", "arabicName", "field", "oldValue", "newValue"].join("\t"));
  const changeList = [...planned.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  for (const change of changeList) {
    for (const f of change.fields) {
      console.log([change.code, change.arabicName, f.field, f.oldValue, f.newValue].join("\t"));
    }
  }

  if (!commit) {
    console.log(`\nانتهى العرض (dry-run) — إجمالي الحسابات المطلوب تعديلها: ${changeList.length}. أضف --commit للتنفيذ الفعلي.`);
    return;
  }

  // ---------- تنفيذ فعلي ----------
  let updatedCount = 0;
  let typeFixApplied = 0;
  for (const change of changeList) {
    const body: Record<string, string> = {};
    for (const f of change.fields) body[f.field] = f.newValue;

    const patchRes = await fetch(`${apiBase}/accounts/${change.accountId}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify(body),
    });
    if (!patchRes.ok) {
      console.error(`فشل تعديل الحساب "${change.code}" (${patchRes.status}).`);
      continue;
    }
    updatedCount++;
    if (change.fields.some((f) => f.field === "type")) typeFixApplied++;
    console.log(`تم تعديل الحساب "${change.code}" بنجاح.`);
  }

  console.log(`\n${updatedCount} accounts updated, ${typeFixApplied} type fix applied.`);
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
