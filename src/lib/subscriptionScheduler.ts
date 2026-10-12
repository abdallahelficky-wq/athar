import { runSubscriptionLifecycle } from "../modules/subscriptions/subscriptionLifecycle.service";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة — مثل reportScheduler؛ الإنفاذ (P4) يقارن التاريخ مباشرة فلا ينتظر النبضة

/**
 * نبضة دورة حياة الاشتراك لكل شركة (§6، المرحلة P3) — تُستدعى مرة عند إقلاع الخادم (server.ts) بنفس نمط reportScheduler: أول
 * فحص بعد 5 دقائق ثم كل ساعة. كل خطوة مُطالَبة بشرط في القاعدة، فتشغيل نسختين من الخادم آمن.
 */
export function startSubscriptionScheduler() {
  const tick = () =>
    runSubscriptionLifecycle().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[subscriptionScheduler] فشل الفحص الدوري:", err);
    });
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
