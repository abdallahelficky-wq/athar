/**
 * تصحيح محدود جداً: تعديل حقل "type" لحسابات بعينها (بأكوادها) ضمن شركة واحدة محدَّدة — عبر الـ API
 * الحقيقي للتطبيق (PATCH /accounts/:id، نفس مسار التعديل العادي المتاح لأي admin/finance_manager،
 * بلا أي حماية خاصة لأن تغيير type وحده لا يمسّ الهيكل/الأكواد/المستويات — تحقّقتُ من ذلك في
 * accounts.controller.ts::validateHierarchy)، وليس عبر كتابة مباشرة لقاعدة البيانات.
 *
 * لا يلمس أي حساب آخر غير المُحدَّد صراحةً بكوده على سطر الأوامر. لا يعدّل الاسم أو الأب أو الكود.
 *
 * وضع افتراضي: Dry-run فقط (يعرض التغيير المُقترَح بلا أي تنفيذ). للتنفيذ الحقيقي مرّر --commit.
 *
 * الاستخدام:
 *   ATHAR_API_BASE="https://<production-host>/api" \
 *   ATHAR_EMAIL="..." ATHAR_PASSWORD="..." \
 *   npx tsx scripts/fix-account-type.ts <companyId> <newType> <code1> [<code2> ...] [--commit]
 *
 * مثال (dry-run):
 *   ATHAR_API_BASE="https://athar-production.example/api" ATHAR_EMAIL="you@x.com" ATHAR_PASSWORD="..." \
 *   npx tsx scripts/fix-account-type.ts cmsrciyjv000ge8f57p2azqdd expense 72 721
 *
 * newType أحد: asset | liability | equity | revenue | expense
 */

const apiBase = process.env.ATHAR_API_BASE;
const email = process.env.ATHAR_EMAIL;
const password = process.env.ATHAR_PASSWORD;
const VALID_TYPES = ["asset", "liability", "equity", "revenue", "expense"];

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const positional = args.filter((a) => a !== "--commit");
  const [companyId, newType, ...codes] = positional;

  if (!apiBase || !email || !password) {
    console.error("مطلوب: ATHAR_API_BASE, ATHAR_EMAIL, ATHAR_PASSWORD كمتغيرات بيئة.");
    process.exit(1);
  }
  if (!companyId || !newType || codes.length === 0) {
    console.error("الاستخدام: npx tsx scripts/fix-account-type.ts <companyId> <newType> <code1> [<code2> ...] [--commit]");
    process.exit(1);
  }
  if (!VALID_TYPES.includes(newType)) {
    console.error(`newType يجب أن يكون أحد: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  console.log(`[${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}] الشركة: ${companyId} — الأكواد: ${codes.join(", ")} → type=${newType}`);

  const loginRes = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.error(`فشل تسجيل الدخول (${loginRes.status}):`, await loginRes.text());
    process.exit(1);
  }
  const { accessToken } = await loginRes.json();
  const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  // tree=true إلزامي هنا: بدونه GET /accounts يُرجع فقط حسابات الترحيل (level 4) ويستبعد الحسابات
  // التجميعية (level 1-3) مثل "72"/"721" — تحديداً نوع الحسابات المستهدَفة بهذا السكريبت.
  const listRes = await fetch(`${apiBase}/accounts?companyId=${encodeURIComponent(companyId)}&tree=true`, { headers: auth });
  if (!listRes.ok) {
    console.error(`فشل جلب شجرة الحسابات (${listRes.status}):`, await listRes.text());
    process.exit(1);
  }
  const allAccounts: any[] = await listRes.json();

  for (const code of codes) {
    console.log(`\n--- الكود ${code} ---`);
    const matches = allAccounts.filter((a) => a.code === code);
    if (matches.length === 0) {
      console.log(`لا يوجد حساب بالكود "${code}" في هذه الشركة — تم تجاوزه.`);
      continue;
    }
    if (matches.length > 1) {
      console.error(`تحذير: أكثر من حساب مطابق للكود "${code}" — تم تجاوزه لتفادي أي غموض. راجع يدوياً.`);
      continue;
    }
    const account = matches[0];
    console.log(`وُجد: id=${account.id} name="${account.name}" type=${account.type} level=${account.level}`);

    if (account.type === newType) {
      console.log(`الحساب type=${newType} بالفعل — لا حاجة لتعديل، تم تجاوزه.`);
      continue;
    }

    if (!commit) {
      console.log(`[DRY-RUN] كان سيُنفَّذ: تغيير type من "${account.type}" إلى "${newType}".`);
      continue;
    }

    const patchRes = await fetch(`${apiBase}/accounts/${account.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ type: newType }),
    });
    if (!patchRes.ok) {
      console.error(`فشل التعديل (${patchRes.status}):`, await patchRes.text());
      continue;
    }
    console.log(`تم التعديل بنجاح: type الآن "${newType}".`);
  }

  console.log(commit ? "\nانتهى التنفيذ." : "\nانتهى العرض (dry-run) — أضف --commit للتنفيذ الفعلي.");
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
