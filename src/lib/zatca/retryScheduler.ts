import { runZatcaAutoRetry } from "../../modules/salesInvoices/salesInvoices.service";

// كل 5 دقائق — أدق بكثير من نبضة تقارير البريد الساعية عمداً (reportScheduler.ts): مهلة إبلاغ
// الفاتورة المبسّطة عن زاتكا (Phase 2) 24 ساعة فقط، وهذا محل بيع نقطة بيع (محطة وقود) بعشرات
// الفواتير في الساعة الواحدة، فانقطاع شبكة ليلي واحد يُنتج مئات الفواتير المتراكمة إن لم تُعاد
// محاولتها بسرعة معقولة بمجرد عودة الاتصال. فترة الانتظار الفعلية بين محاولتين لنفس الفاتورة
// أطول من هذا (تصاعدية حتى ساعة، راجع ZATCA_AUTO_RETRY_BACKOFF_MINUTES في salesInvoices.service.ts)
// — هذا فقط تكرار فحص "هل توجد فاتورة مستحقة الآن؟"، لا معدّل إرسال فعلي لكل فاتورة.
const TICK_INTERVAL_MS = 5 * 60 * 1000;

async function tick() {
  const summary = await runZatcaAutoRetry();
  if (summary.attempted === 0) return;
  // eslint-disable-next-line no-console
  console.log(
    `[zatcaRetryScheduler] محاولة=${summary.attempted} نجحت=${summary.succeeded} رُفضت=${summary.rejected} لا تزال فاشلة=${summary.stillFailing}`,
  );
}

/** يبدأ نبضة دورية تعيد محاولة إرسال الفواتير التي لم تصل لزاتكا بعد — يُستدعى مرة واحدة عند
 * إقلاع الخادم (server.ts)، بنفس نمط startReportScheduler (تأخير أول لاستقرار اتصال قاعدة
 * البيانات، ثم نبضة دورية لا تسقط الخادم عند فشلها). */
export function startZatcaRetryScheduler() {
  setTimeout(() => {
    tick().catch((err) => console.error("[zatcaRetryScheduler] فشل الفحص الدوري الأول:", err));
    setInterval(() => {
      tick().catch((err) => console.error("[zatcaRetryScheduler] فشل الفحص الدوري:", err));
    }, TICK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
