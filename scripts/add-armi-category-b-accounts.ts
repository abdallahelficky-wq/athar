/**
 * إضافة محدودة جداً: إنشاء 23 حساب تفصيلي (فئة "ب" من مقارنة تصدير قيود القديم مع شجرة أثر
 * الحالية لشركة أرمي للصناعة) — عبر الـ API الحقيقي للتطبيق (POST /accounts، نفس مسار الإنشاء
 * العادي المتاح لأي admin/finance_manager)، وليس عبر كتابة مباشرة لقاعدة البيانات.
 *
 * لا يلمس أي حساب موجود، ولا يعدّل أي شيء غير إنشاء الحسابات الـ23 المحدَّدة أدناه بأسمائها
 * الحرفية كما وردت في تصدير قيود (بلا أي تغيير في الاسم). الأكواد تُولَّد تلقائياً من الـ API
 * (POST /accounts بلا حقل code يستدعي generateNextCode) — لا تُفرَض يدوياً.
 *
 * وضع افتراضي: Dry-run فقط (يعرض ما سيُنشَأ بلا أي تنفيذ). للتنفيذ الحقيقي مرّر --commit.
 *
 * الاستخدام:
 *   ATHAR_API_BASE="https://<production-host>/api" \
 *   ATHAR_EMAIL="..." ATHAR_PASSWORD="..." \
 *   npx tsx scripts/add-armi-category-b-accounts.ts <companyId> [--commit]
 */

const apiBase = process.env.ATHAR_API_BASE;
const email = process.env.ATHAR_EMAIL;
const password = process.env.ATHAR_PASSWORD;

// المجموعة الأب لكل حساب مُحدَّدة بكودها (كما هي فعلياً على شجرة أرمي المُثبَّتة)، والاسم حرفياً
// كما ورد في تصدير قيود — بنفس الترتيب المُتَّفَق عليه.
const ACCOUNTS_TO_ADD: { parentCode: string; name: string }[] = [
  // عُهد نقدية (9) — تحت "113 ذمم مدينة أخرى"
  { parentCode: "113", name: "عهدة سالم" },
  { parentCode: "113", name: "عهدة جانجير ابوعمر" },
  { parentCode: "113", name: "عهدة اشرف الصايغ" },
  { parentCode: "113", name: "عهدة بكر الجيزاني" },
  { parentCode: "113", name: "عهدة اسلام احمد" },
  { parentCode: "113", name: "عهدة كاش علاء الدين" },
  { parentCode: "113", name: "عهدة كاش عمران الشيخ" },
  { parentCode: "113", name: "نقداً مع شعيب" },
  { parentCode: "113", name: "المصروفات النثرية مع أولا" },
  // سلف موظفين (13) — تحت "113 ذمم مدينة أخرى"
  { parentCode: "113", name: "اشرف مروان الصايغ" },
  { parentCode: "113", name: "فرج منصور فرج" },
  { parentCode: "113", name: "سيد بكري عبدالعظيم" },
  { parentCode: "113", name: "علا (مدير الإنتاج)" },
  { parentCode: "113", name: "إبراهيم عبد الله (سائق بروكلين)" },
  { parentCode: "113", name: "أمير حسن كليب" },
  { parentCode: "113", name: "مراد درويس" },
  { parentCode: "113", name: "علاء الدين" },
  { parentCode: "113", name: "محمد رستم" },
  { parentCode: "113", name: "شعيب رياض" },
  { parentCode: "113", name: "فؤاد عبدالله قاسم" },
  { parentCode: "113", name: "محمد فیاض" },
  { parentCode: "113", name: "عامر سليمان محمد" },
  // مخزون (1) — تحت "114 المخزون"
  { parentCode: "114", name: "المركبات التي تم شراؤها" },
];

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const [companyId] = args.filter((a) => a !== "--commit");

  // بصمة تشغيل صريحة — لتأكيد أن النسخة المُنفَّذة فعلياً هي أحدث نسخة من هذا الملف، ولضمان ظهور
  // أي رسالة لاحقة حتى لو أُعيد توجيه الإخراج بطريقة تلتقط الإخراج القياسي فقط (كل شيء هنا console.log
  // عمداً — بلا console.error — حتى لا تختفي رسائل الفشل عند إعادة التوجيه البسيطة في PowerShell).
  console.log(`[add-armi-category-b-accounts.ts] cwd=${process.cwd()}`);

  if (!apiBase || !email || !password) {
    console.log("مطلوب: ATHAR_API_BASE, ATHAR_EMAIL, ATHAR_PASSWORD كمتغيرات بيئة.");
    process.exit(1);
  }
  if (!companyId) {
    console.log("الاستخدام: npx tsx scripts/add-armi-category-b-accounts.ts <companyId> [--commit]");
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

  // tree=true إلزامي: بدونه GET /accounts يُرجع فقط حسابات الترحيل (level 4) ويستبعد حسابات
  // المجموعات (113/114) التي نحتاج معرّفها كأب للحسابات الجديدة.
  const listRes = await fetch(`${apiBase}/accounts?companyId=${encodeURIComponent(companyId)}&tree=true`, { headers: auth });
  if (!listRes.ok) {
    console.log(`فشل جلب شجرة الحسابات (${listRes.status}):`, await listRes.text());
    process.exit(1);
  }
  console.log(`تم جلب شجرة الحسابات: ${(await listRes.clone().json()).length} حساب.`);
  const allAccounts: any[] = await listRes.json();

  // نتتبّع أعلى لاحقة كود مستخدمة تحت كل أب محلياً، ونزيدها بنفس منطق generateNextCode الفعلي
  // (src/lib/accountCodes.ts) لعرض الكود المتوقع في وضع الـ dry-run فقط — الـ API هو من يولّد
  // الكود الحقيقي فعلياً وقت --commit، هذا العرض للمراجعة قبل التنفيذ لا أكثر.
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

  let created = 0;
  let skipped = 0;

  for (const item of ACCOUNTS_TO_ADD) {
    const parent = allAccounts.find((a) => a.code === item.parentCode);
    if (!parent) {
      console.log(`\n--- "${item.name}" ---\nتعذّر: لا يوجد حساب أب بالكود "${item.parentCode}" في هذه الشركة — تم تجاوزه.`);
      skipped += 1;
      continue;
    }

    const existingSibling = allAccounts.find((a) => a.parentId === parent.id && a.name === item.name);
    if (existingSibling) {
      console.log(`\n--- "${item.name}" ---\nموجود بالفعل تحت "${parent.name}" (${existingSibling.code}) — تم تجاوزه لتفادي التكرار.`);
      skipped += 1;
      continue;
    }

    const suffixWidth = 6 - parent.code.length;
    const nextSuffix = (suffixByParentCode.get(parent.code) || 0) + 1;
    const expectedCode = parent.code + String(nextSuffix).padStart(suffixWidth, "0");

    console.log(`\n--- "${item.name}" ---`);
    console.log(`تحت: "${parent.name}" (${parent.code}) — النوع: ${parent.type} — الكود المتوقع: ${expectedCode}`);

    if (!commit) {
      console.log("[DRY-RUN] كان سيُنشَأ الآن.");
      suffixByParentCode.set(parent.code, nextSuffix);
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
    // إضافته لقائمة الحسابات المحلية حتى يُحتسَب صحيحاً كأخ عند فحص التكرار للحسابات التالية في
    // نفس التشغيلة (لا تأثير على suffixByParentCode لأنه غير مُستخدَم فعلياً في مسار --commit).
    allAccounts.push(newAccount);
    created += 1;
  }

  console.log(`\n${commit ? "انتهى التنفيذ" : "انتهى العرض (dry-run)"}. أُنشئ/سيُنشأ: ${created} — تم تجاوزه: ${skipped}.`);
  if (!commit) console.log("أضف --commit للتنفيذ الفعلي بعد المراجعة.");
}

main().catch((err) => {
  console.log("خطأ غير متوقع:", err);
  process.exit(1);
});
