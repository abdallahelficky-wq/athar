import { existsSync } from "fs";
import { createApp } from "./app";
import { env } from "./config/env";
import { startReportScheduler } from "./lib/reportScheduler";
import { startZatcaRetryScheduler } from "./lib/zatca/retryScheduler";

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
  // هذا التحذير الصريح عند الإقلاع هو خط الدفاع الوحيد ضد تكرار نفس النمط مستقبلاً.
  if (env.nodeEnv === "production" && (!env.chromiumExecutablePath || !existsSync(env.chromiumExecutablePath))) {
    // eslint-disable-next-line no-console
    console.error(
      "⚠️⚠️⚠️ تحذير: CHROMIUM_EXECUTABLE_PATH غير مضبوط أو يشير لمسار غير موجود في بيئة الإنتاج — " +
        "كل ميزات توليد PDF ستفشل: تحميل PDF لسند القيد المحاسبي، إرفاق PDF عند إرسال فاتورة مبيعات " +
        "بالإيميل (يحدث تلقائياً بعد كل ترحيل، بلا أي خطأ ظاهر للمستخدم إن فشل)، وتحميل/إرسال عقد " +
        "إيواء الخيل بالإيميل. أضِف Chromium إلى nixpacks.toml وحدِّد المتغيّر من لوحة Railway " +
        "(خدمة athar ← Variables) بمسار الثنائي الفعلي، ثم أعد النشر. ⚠️⚠️⚠️",
    );
  }
});

startReportScheduler();
startZatcaRetryScheduler();
