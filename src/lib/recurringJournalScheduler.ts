import { runDueRecurringJournals } from "../modules/recurringJournals/recurringJournals.service";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة — المواعيد بالأيام، وحجز كل موعد ذرّي (RecurringJournalRun) فلا تكرار

/** نبضة تُستدعى مرة عند إقلاع الخادم (server.ts): أول فحص بعد دقيقتين ثم كل ساعة. */
export function startRecurringJournalScheduler() {
  const tick = () =>
    runDueRecurringJournals().catch((err) => {
      console.error("[recurringJournalScheduler] فشل الفحص الدوري:", err);
    });
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, 2 * 60 * 1000);
}
