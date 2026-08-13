/**
 * تصحيح استثنائي محدود جداً: فك ترحيل ثم حذف قيود يومية بعينها (بأرقامها الظاهرة، مثل J00001)
 * ضمن شركة واحدة محدَّدة — عبر الـ API الحقيقي للتطبيق (نفس مسار unpostJournalEntry/deleteJournalEntry
 * الموجود بالفعل في journalEntries.service.ts، بنفس التحقق من الرقم السري وكتابة سجل تدقيق)، وليس
 * عبر كتابة مباشرة لقاعدة البيانات — حتى تُطبَّق كل الشروط/الآثار الجانبية المعتادة (بما فيها منع
 * فك ترحيل قيد غير مرحّل أصلاً، ومنع حذف قيد لا يزال مرحّلاً).
 *
 * لا يلمس أي قيد آخر غير المُحدَّد صراحةً بأرقامه على سطر الأوامر.
 *
 * وضع افتراضي: Dry-run فقط (يعرض ماذا سيحدث بلا أي تنفيذ فعلي). للتنفيذ الحقيقي مرّر --commit.
 *
 * الاستخدام:
 *   ATHAR_API_BASE="https://<production-host>/api" \
 *   ATHAR_EMAIL="..." ATHAR_PASSWORD="..." ATHAR_UNLOCK_PIN="..." \
 *   npx tsx scripts/unpost-and-delete-entries.ts <companyId> <entryNumber1> [entryNumber2] ... [--commit]
 *
 * مثال (dry-run):
 *   ATHAR_API_BASE="https://athar-production.example/api" ATHAR_EMAIL="you@x.com" \
 *   ATHAR_PASSWORD="..." ATHAR_UNLOCK_PIN="1234" \
 *   npx tsx scripts/unpost-and-delete-entries.ts cms3fplst000dxuo7tj093pif J00001 J00002
 *
 * لتنفيذها فعلياً أضف --commit في آخر السطر.
 */

const apiBase = process.env.ATHAR_API_BASE;
const email = process.env.ATHAR_EMAIL;
const password = process.env.ATHAR_PASSWORD;
const pin = process.env.ATHAR_UNLOCK_PIN;

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const positional = args.filter((a) => a !== "--commit");
  const [companyId, ...entryNumbers] = positional;

  if (!apiBase || !email || !password || !pin) {
    console.error("مطلوب: ATHAR_API_BASE, ATHAR_EMAIL, ATHAR_PASSWORD, ATHAR_UNLOCK_PIN كمتغيرات بيئة.");
    process.exit(1);
  }
  if (!companyId || entryNumbers.length === 0) {
    console.error("الاستخدام: npx tsx scripts/unpost-and-delete-entries.ts <companyId> <entryNumber1> [entryNumber2] ... [--commit]");
    process.exit(1);
  }

  console.log(`[${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}] الشركة: ${companyId} — القيود: ${entryNumbers.join(", ")}`);

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

  for (const entryNumber of entryNumbers) {
    console.log(`\n--- ${entryNumber} ---`);

    const listRes = await fetch(
      `${apiBase}/journal-entries?companyId=${encodeURIComponent(companyId)}&entryNumber=${encodeURIComponent(entryNumber)}`,
      { headers: auth },
    );
    if (!listRes.ok) {
      console.error(`فشل البحث عن القيد (${listRes.status}):`, await listRes.text());
      continue;
    }
    const matches = (await listRes.json()).filter((e: any) => e.entryNumber === entryNumber);
    if (matches.length === 0) {
      console.log(`لا يوجد قيد بالرقم "${entryNumber}" في هذه الشركة — تم تجاوزه.`);
      continue;
    }
    if (matches.length > 1) {
      console.error(`تحذير: أكثر من قيد مطابق للرقم "${entryNumber}" — تم تجاوزه لتفادي أي غموض. راجع يدوياً.`);
      continue;
    }
    const entry = matches[0];
    console.log(`وُجد: id=${entry.id} status=${entry.status} date=${entry.date} memo=${entry.memo || "-"}`);

    if (!commit) {
      console.log(entry.status === "posted"
        ? "[DRY-RUN] كان سيُنفَّذ: فك ترحيل ثم حذف."
        : `[DRY-RUN] القيد ليس مرحّلاً (status=${entry.status}) — كان سيُنفَّذ: حذف مباشرة بلا حاجة لفك ترحيل.`);
      continue;
    }

    if (entry.status === "posted") {
      const unpostRes = await fetch(`${apiBase}/journal-entries/${entry.id}/unpost`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ pin }),
      });
      if (!unpostRes.ok) {
        console.error(`فشل فك الترحيل (${unpostRes.status}):`, await unpostRes.text());
        continue;
      }
      console.log("تم فك الترحيل بنجاح.");
    }

    const deleteRes = await fetch(`${apiBase}/journal-entries/${entry.id}`, { method: "DELETE", headers: auth });
    if (!deleteRes.ok) {
      console.error(`فشل الحذف (${deleteRes.status}):`, await deleteRes.text());
      continue;
    }
    console.log("تم الحذف بنجاح.");
  }

  console.log(commit ? "\nانتهى التنفيذ." : "\nانتهى العرض (dry-run) — أضف --commit للتنفيذ الفعلي.");
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
