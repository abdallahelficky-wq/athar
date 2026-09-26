// أداة تعقّب صغيرة لمرحلتَي الكتابة القصيرتين في postingPipeline (المرحلة 1: حجز الترقيم/السلسلة
// وإنشاء الصف؛ المرحلة 3ب: القيد المحاسبي والمخزون والعمولات) — تُسجِّل مدة كل معاملة فعلياً
// ونداءات Prisma داخلها، بلا أي محتوى حسّاس (لا بيانات عميل، لا مبالغ، لا نص خام)، حتى يمكن إثبات
// من سجلّات الإنتاج وحدها أن هاتين المعاملتين قصيرتان فعلاً، لا مجرد افتراض نظري كما كان — هذا
// بالضبط نوع الافتراض ("8 ثوانٍ هامش أمان معقول") الذي ثبت خطأه فعلياً في الحادثة التي دفعت لهذا
// الإصلاح بالكامل.

/** عدّاد نداءات Prisma داخل معاملة واحدة — تقريب عملي (عدد نداءات Prisma على مستوى الكود، لا عدد
 * جُمَل SQL الفعلية التي قد يُصدرها كل نداء)، لا حاجة لتفعيل تسجيل استعلامات Prisma العام لهذا. */
export interface QueryCounter {
  n: number;
}

export function newQueryCounter(): QueryCounter {
  return { n: 0 };
}

/** يلف أي نداء Prisma (أو دالة مساعدة تستدعي Prisma) ليُحتسَب ضمن عدّاد المعاملة الحالية — الاستخدام:
 * await counted(counter, tx.salesInvoice.create({...})). */
export function counted<T>(counter: QueryCounter, promise: Promise<T>): Promise<T> {
  counter.n++;
  return promise;
}

/** سطر سجلّ آمن ثابت (لا محتوى حسّاس) لمدة/حجم معاملة قصيرة — يُستدعى دائماً (نجاح أو فشل) عبر
 * finally في المُستدعي، حتى تظهر مدة المعاملات الفاشلة أيضاً (هي بالضبط ما يهم في حادثة كهذه). */
export function logPostingPhaseTiming(params: { phase: "1" | "3b"; kind: "invoice" | "credit_note" | "debit_note"; startedAt: number; counter: QueryCounter; outcome: "committed" | "failed" }) {
  const durationMs = Date.now() - params.startedAt;
  // eslint-disable-next-line no-console
  console.info(
    `[zatca-posting-instrumentation] phase=${params.phase} kind=${params.kind} outcome=${params.outcome} durationMs=${durationMs} queries=${params.counter.n}`,
  );
}
