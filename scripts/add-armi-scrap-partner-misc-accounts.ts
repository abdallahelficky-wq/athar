/**
 * إضافة محدودة: إنشاء 9 حسابات جديدة على شجرة أرمي للصناعة (8 حسابات ترحيل + مجموعة مستوى 3
 * واحدة تحمل أحدها) — نتيجة مطابقة ملف القيود الكامل (reference/armi_full_journal_2023_2026.csv)
 * مع الشجرة الحالية ومراجعة بشرية صريحة لكل حساب غير متطابق تلقائياً (راجع محادثة الجلسة لتفاصيل
 * كل قرار). بنفس نمط add-armi-category-b-accounts.ts بالضبط: عبر الـ API الحقيقي (POST /accounts)،
 * لا كتابة مباشرة لقاعدة البيانات، ولا يلمس أي حساب موجود.
 *
 * الحسابات والقرار خلف كل واحد:
 *   - جاري الشريك سالم بالحارث / جاري الشريك بدر القرني (تحت 341 الحساب الجاري للشركاء):
 *     حسابا شريكين بالاسم صراحةً، بنفس مبدأ حسابات الشركاء الجاري الموجودة.
 *   - مشروعات تحت التنفيذ (تحت 121 الممتلكات والآلات والمعدات): أصل ثابت (Capital WIP) — قرار
 *     صريح: تحت الأصول الثابتة لا المخزون، رغم التشابه اللفظي مع "مخزون إنتاج تحت التشغيل".
 *   - مخزون الخردة (تحت 114 المخزون): مخزون نشاط تفكيك المركبات/تجارة الخردة — نشاط جوهري لأرمي
 *     حسب تأكيد صريح، لا نشاط ثانوي.
 *   - تكلفة بضاعة مباعة - خردة وقطع غيار (تحت 511 تكلفة الإيرادات): حساب تكلفة واحد يخدم بندين في
 *     ملف القيود معاً ("تكلفة البضائع المباعة الأجزاء" و"تكلفة البضائع المباعة من خردة الحديد").
 *   - إيرادات قطع الغيار (تحت 411 إيرادات النشاط): إيراد منفصل عمداً عن إيراد بيع السكراب (الذي
 *     استخدم الحساب الموجود بالفعل 411004 بدل إنشاء حساب مكرر — لا يظهر هنا لهذا السبب).
 *   - شركة يسم للتجارة (تحت 112 الذمم المدينة التجارية): صافي رصيدها مدين (+11,783.32 من إجمالي
 *     تدفق ~1.94م بالاتجاهين) — تصنيف أولي فقط بانتظار مراجعة بشرية لاحقة لطبيعتها الحقيقية
 *     (قد تكون تسوية بينية بين شركات المجموعة لا عميلاً تقليدياً).
 *   - مصروفات متنوعة أخرى (مستوى 3 جديدة تحت 66) + مصاريف أخرى (مستوى 4 ترحيل تحتها): "66
 *     مصروفات أخرى تشغيلية" مستوى 2 — أبناؤه المباشرون في الشجرة الحالية كلهم مستوى 3 تجميعي
 *     (661/662)، لا حساب ترحيل مباشر تحته. حساب "مصاريف أخرى" (يجب أن يكون قابلاً للترحيل ليصلح
 *     لمطابقة الاستيراد الجماعي) يحتاج إذن مجموعة مستوى 3 جديدة أولاً ثم حساب الترحيل تحتها — وليس
 *     إنشاءه مباشرة تحت "66" (كان سينتج حساب مجموعة مستوى 3 غير قابل للترحيل بلا فائدة، كما ظهر
 *     فعلياً عند اختبار السكريبت محلياً قبل هذا التصحيح). يخدم هذا الحساب 5 بنود من ملف القيود
 *     (مصاريف أخرى نفسها + مصاريف التأسيس + نفقات الأدوات + مصاريف ضيافة + رسوم التوصيل).
 *
 * وضع افتراضي: Dry-run فقط (يعرض ما سيُنشَأ بلا أي تنفيذ). للتنفيذ الحقيقي مرّر --commit.
 *
 * الاستخدام:
 *   ATHAR_API_BASE="https://<production-host>/api" \
 *   ATHAR_EMAIL="..." ATHAR_PASSWORD="..." \
 *   npx tsx scripts/add-armi-scrap-partner-misc-accounts.ts <companyId> [--commit]
 */

const apiBase = process.env.ATHAR_API_BASE;
const email = process.env.ATHAR_EMAIL;
const password = process.env.ATHAR_PASSWORD;

interface AccountToAdd {
  parentCode: string;
  name: string;
  /** true (افتراضي) = حساب ترحيل (مستوى يساوي مستوى الأب + 1، isPosting=true إن كان الأب مستوى 3).
   * false = مجموعة تجميعية جديدة (تُستخدَم فقط لمجموعة "مصروفات متنوعة أخرى" أدناه، حتى يصلح
   * كودها الناتج كأب لحساب ترحيل لاحق في نفس التشغيلة). */
  isPostingLeaf?: boolean;
}

const ACCOUNTS_TO_ADD: AccountToAdd[] = [
  // شركاء — تحت "341 الحساب الجاري للشركاء"
  { parentCode: "341", name: "جاري الشريك سالم بالحارث" },
  { parentCode: "341", name: "جاري الشريك بدر القرني" },
  // أصل ثابت — تحت "121 الممتلكات والآلات والمعدات"
  { parentCode: "121", name: "مشروعات تحت التنفيذ" },
  // نشاط الخردة/قطع الغيار
  { parentCode: "114", name: "مخزون الخردة" },
  { parentCode: "511", name: "تكلفة بضاعة مباعة - خردة وقطع غيار" },
  { parentCode: "411", name: "إيرادات قطع الغيار" },
  // طرف تسوية/عميل محتمل — تحت "112 الذمم المدينة التجارية"
  { parentCode: "112", name: "شركة يسم للتجارة" },
  // مجموعة مستوى 3 جديدة (غير قابلة للترحيل) — راجع الشرح أعلاه لسبب الحاجة لهذه الخطوة الوسيطة
  { parentCode: "66", name: "مصروفات متنوعة أخرى", isPostingLeaf: false },
  // حساب الترحيل الفعلي — أبوه هو المجموعة أعلاه بالضبط، لذا يجب أن يُعالَج بعدها في القائمة (الترتيب مُهم)
  { parentCode: "66/مصروفات متنوعة أخرى", name: "مصاريف أخرى" },
];

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const [companyId] = args.filter((a) => a !== "--commit");

  console.log(`[add-armi-scrap-partner-misc-accounts.ts] cwd=${process.cwd()}`);

  if (!apiBase || !email || !password) {
    console.log("مطلوب: ATHAR_API_BASE, ATHAR_EMAIL, ATHAR_PASSWORD كمتغيرات بيئة.");
    process.exit(1);
  }
  if (!companyId) {
    console.log("الاستخدام: npx tsx scripts/add-armi-scrap-partner-misc-accounts.ts <companyId> [--commit]");
    process.exit(1);
  }

  console.log(`[${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}] الشركة: ${companyId} — عدد الحسابات المطلوب إضافتها: ${ACCOUNTS_TO_ADD.length}`);

  console.log(`جارٍ تسجيل الدخول عبر ${apiBase}/auth/login ...`);
  let loginRes: Response;
  try {
    loginRes = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    console.log("فشل الاتصال بـ ATHAR_API_BASE (تحقق من الرابط/الشبكة):", String(err));
    process.exit(1);
  }
  if (!loginRes.ok) {
    console.log(`فشل تسجيل الدخول (${loginRes.status}):`, await loginRes.text());
    process.exit(1);
  }
  const { accessToken } = await loginRes.json();
  const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  console.log("تم تسجيل الدخول بنجاح.");

  const listRes = await fetch(`${apiBase}/accounts?companyId=${encodeURIComponent(companyId)}&tree=true`, { headers: auth });
  if (!listRes.ok) {
    console.log(`فشل جلب شجرة الحسابات (${listRes.status}):`, await listRes.text());
    process.exit(1);
  }
  console.log(`تم جلب شجرة الحسابات: ${(await listRes.clone().json()).length} حساب.`);
  const allAccounts: any[] = await listRes.json();

  const suffixByParentCode = new Map<string, number>();
  for (const acc of allAccounts) {
    if (acc.parentId) {
      const parent = allAccounts.find((p) => p.id === acc.parentId);
      if (parent) {
        const suffix = Number(acc.code.slice(parent.code.length)) || 0;
        suffixByParentCode.set(parent.code, Math.max(suffixByParentCode.get(parent.code) || 0, suffix));
      }
    }
  }

  // طول كود كل مستوى (1/2/3/4 → 1/2/3/6 رقماً) — مطابق تماماً لـ LEVEL_CODE_LENGTH في
  // ChartOfAccountsModule.jsx (الواجهة). يُستخدَم هنا فقط لعرض الكود المتوقع بشكل صحيح في وضع
  // dry-run (خصوصاً عند إنشاء مجموعة مستوى 3 جديدة، لا حساب ترحيل مستوى 4 مباشرة) — الكود الفعلي
  // يُولَّد من الـ API نفسه وقت --commit بصرف النظر عن هذا العرض.
  const CODE_LENGTH_BY_LEVEL: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6 };
  function totalCodeLengthForChildOf(parentLevel: number): number {
    return CODE_LENGTH_BY_LEVEL[parentLevel + 1] ?? parentLevel + 1;
  }

  // معرّف "أب مركّب" مؤقت لحساب لم يُنشأ فعلياً بعد في وضع dry-run (لا id حقيقي متاح) — يُستخدَم فقط
  // لربط "مصاريف أخرى" بمجموعتها الجديدة "مصروفات متنوعة أخرى" ضمن نفس التشغيلة، بصرف النظر عن
  // كون هذه مجرد معاينة (dry-run) أو تنفيذاً فعلياً.
  const pendingByKey = new Map<string, { id: string; code: string; name: string; type: string; level: number }>();

  let created = 0;
  let skipped = 0;

  for (const item of ACCOUNTS_TO_ADD) {
    // "66/مصروفات متنوعة أخرى" مرجع مركّب لحساب أُنشئ للتو في نفس التشغيلة (بالكود الفعلي وقت
    // --commit، أو بمعرّف مؤقت في وضع dry-run) — وليس كوداً فعلياً في الشجرة الأصلية.
    const parent = item.parentCode.includes("/")
      ? pendingByKey.get(item.parentCode)
      : allAccounts.find((a) => a.code === item.parentCode);

    if (!parent) {
      console.log(`\n--- "${item.name}" ---\nتعذّر: لا يوجد حساب أب بالمرجع "${item.parentCode}" — تم تجاوزه.`);
      skipped += 1;
      continue;
    }

    const existingSibling = allAccounts.find((a) => a.parentId === parent.id && a.name === item.name);
    if (existingSibling) {
      console.log(`\n--- "${item.name}" ---\nموجود بالفعل تحت "${parent.name}" (${existingSibling.code}) — تم تجاوزه لتفادي التكرار.`);
      skipped += 1;
      pendingByKey.set(`${item.parentCode}/${item.name}`, existingSibling);
      continue;
    }

    const totalLength = totalCodeLengthForChildOf(parent.level);
    const suffixWidth = totalLength - parent.code.length;
    const nextSuffix = (suffixByParentCode.get(parent.code) || 0) + 1;
    const expectedCode = parent.code + String(nextSuffix).padStart(suffixWidth, "0");
    const leafLabel = item.isPostingLeaf === false ? "مجموعة (غير قابلة للترحيل)" : "حساب ترحيل";

    console.log(`\n--- "${item.name}" (${leafLabel}) ---`);
    console.log(`تحت: "${parent.name}" (${parent.code}) — النوع: ${parent.type} — الكود المتوقع: ${expectedCode}`);

    if (!commit) {
      console.log("[DRY-RUN] كان سيُنشَأ الآن.");
      suffixByParentCode.set(parent.code, nextSuffix);
      // معرّف مؤقت (ليس حقيقياً) يكفي فقط لربط الحساب التالي في dry-run بهذا الحساب كأب
      pendingByKey.set(`${item.parentCode}/${item.name}`, {
        id: `dry-run:${expectedCode}`,
        code: expectedCode,
        name: item.name,
        type: parent.type,
        level: parent.level + 1,
      });
      created += 1;
      continue;
    }

    const createRes = await fetch(`${apiBase}/accounts`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ companyId, parentId: parent.id, name: item.name, type: parent.type }),
    });
    if (!createRes.ok) {
      console.log(`فشل الإنشاء (${createRes.status}):`, await createRes.text());
      continue;
    }
    const newAccount = await createRes.json();
    console.log(`تم الإنشاء بنجاح: ${newAccount.code} — "${newAccount.name}"`);
    allAccounts.push(newAccount);
    pendingByKey.set(`${item.parentCode}/${item.name}`, newAccount);
    created += 1;
  }

  console.log(`\n${commit ? "انتهى التنفيذ" : "انتهى العرض (dry-run)"}. أُنشئ/سيُنشأ: ${created} — تم تجاوزه: ${skipped}.`);
  if (!commit) console.log("أضف --commit للتنفيذ الفعلي بعد المراجعة.");
}

main().catch((err) => {
  console.log("خطأ غير متوقع:", err);
  process.exit(1);
});
