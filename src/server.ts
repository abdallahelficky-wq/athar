import { createApp } from "./app";
import { env } from "./config/env";
import { startReportScheduler } from "./lib/reportScheduler";

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
});

startReportScheduler();
