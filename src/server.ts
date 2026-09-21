import { createApp } from "./app";
import { env } from "./config/env";
import { startReportScheduler } from "./lib/reportScheduler";
import { startZatcaRetryScheduler } from "./lib/zatca/retryScheduler";
import { renderHtmlToPdf } from "./lib/zatca/pdf/renderPdf";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Athar backend يعمل على المنفذ ${env.port} (${env.nodeEnv})`);
  // بدون RESEND_API_KEY، src/lib/mailer.ts يكتفي بطباعة كل إيميل في الـ logs بدل إرساله فعلياً،
  // ويُبلِغ كل نقاط الاستدعاء (تسجيل/دعوة/فاتورة) بأنه "نجح" — فشل صامت تماماً بلا أي خطأ ظاهر
  // في الواجهة. هذا التحذير الصريح عند الإقلاع في بيئة الإنتاج تحديداً هو خط الدفاع الوحيد ضد
  // تكرار هذا الخلل دون ملاحظته لأسابيع (كما حدث فعلياً).
  if (env.nodeEnv === "production" && !env.resendApiKey) {
    // eslint-disable-next-line no-console
    console.error(
      "⚠️⚠️⚠️ تحذير: RESEND_API_KEY غير مضبوط في بيئة الإنتاج — كل الإيميلات (ترحيب، دعوة مستخدم، " +
        "إرسال فاتورة) ستُطبَع في الـ logs فقط ولن تُرسَل فعلياً لأي مستلم. أضِف المتغيّر من لوحة " +
        "Railway (خدمة athar ← Variables) وأعد النشر. ⚠️⚠️⚠️",
    );
  }
  // بنفس منطق تحذير RESEND_API_KEY أعلاه، ولنفس السبب بالضبط: عطل فعلي وقع فعلاً بصمت تام لعدّة
  // أشهر — كل ميزات توليد PDF (renderHtmlToPdf عبر Chromium) فشلت باستمرار في الإنتاج، بما فيها
  // إرفاق PDF عند إرسال كل فاتورة مبيعات بالإيميل تلقائياً بعد الترحيل (sendInvoiceByEmail تبتلع
  // الخطأ عمداً حتى لا توقف الترحيل — راجع تعليقها)، بلا أي رسالة خطأ ظاهرة لأي مستخدم إطلاقاً.
  //
  // عطل إنتاج فعلي سابق كان مجرد فحص وجود الملف (existsSync) هنا كافياً لإخفاء المشكلة الحقيقية:
  // الملف قد لا يوجد إطلاقاً (تماماً ما حدث فعلياً — راجع فرع fix/pdf-chromium-production) لكن
  // حتى لو وُجد، قد يكون بلا صلاحية تنفيذ أو تنقصه مكتبات مشتركة تمنعه من الإقلاع فعلياً — فحص
  // وجود الملف وحده لا يثبت شيئاً. إقلاع Chromium فعلياً وتصيير PDF تجريبي صغير هو الدليل الوحيد
  // الموثوق أن توليد PDF يعمل فعلاً في هذه البيئة بالذات. لا يوقف إقلاع الخادم أبداً (بلا await هنا
  // إطلاقاً، فلا يؤخّر app.listen ولا يمنع استقبال أي طلب)، ولا يمنع ترحيل زاتكا أو أي شيء آخر من
  // العمل حتى لو فشل هذا الفحص تماماً — نفس فلسفة sendInvoiceByEmail بالضبط: تسجيل الفشل بصوت
  // عالٍ، بلا إيقاف أي شيء آخر.
  if (env.nodeEnv === "production") {
    renderHtmlToPdf("<html><body>ping</body></html>")
      .then(() => {
        // eslint-disable-next-line no-console
        console.log("✅ محرّك توليد PDF (Chromium) يعمل بنجاح عند الإقلاع.");
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          "⚠️⚠️⚠️ تحذير: فشل تصيير PDF تجريبي عند إقلاع الخادم في بيئة الإنتاج — كل ميزات توليد PDF " +
            "ستفشل: تحميل PDF لسند القيد المحاسبي، إرفاق PDF عند إرسال فاتورة مبيعات بالإيميل (يحدث " +
            "تلقائياً بعد كل ترحيل، بلا أي خطأ ظاهر للمستخدم إن فشل)، وتحميل/إرسال عقد إيواء الخيل " +
            "بالإيميل. تحقّق من نجاح تثبيت حزمة Chromium في صورة البناء (railpack.json) ومن " +
            `CHROMIUM_EXECUTABLE_PATH إن كان مضبوطاً. الخطأ الفعلي: ${err instanceof Error ? err.message : String(err)} ⚠️⚠️⚠️`,
        );
      });
  }
});

startReportScheduler();
startZatcaRetryScheduler();
