import { prisma } from "./prisma";
import { sendLeaseReminder } from "../modules/leaseContracts/leaseContracts.service";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // كل 5 دقائق — الموعد بالدقيقة (hourKsa:minuteKsa)، فالتأخير عن الموعد أقل من 5 دقائق
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // توقيت السعودية ثابت UTC+3 بلا توقيت صيفي

/**
 * يرسل بريد تنبيهات الإيجارات للشركات التي فعّلته وحان موعدها اليوم (وقت السعودية ≥ hourKsa:minuteKsa) ولم يُرسَل لها اليوم. المطالبة
 * باليوم ذرّية قبل الإرسال (شرط على lastSentPeriodKey في UPDATE نفسه) — نسختان من الخادم أو نبضتان متداخلتان لا ترسلان مرتين.
 * اليوم يُطالَب به حتى إن لم يوجد ما يُنبَّه عليه أو فشل الإرسال: تفادي التكرار أهم، و«إرسال الآن» بديل يدوي.
 */
export async function runDueLeaseReminders(utcNow: Date = new Date()) {
  const shifted = new Date(utcNow.getTime() + KSA_OFFSET_MS);
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const periodKey = shifted.toISOString().slice(0, 10);
  const enabled = await prisma.leaseReminderSetting.findMany({ where: { enabled: true } });
  const settings = enabled.filter((s) => s.hourKsa * 60 + s.minuteKsa <= minuteOfDay);
  let sent = 0;
  for (const setting of settings) {
    if (setting.lastSentPeriodKey === periodKey) continue;
    const claim = await prisma.leaseReminderSetting.updateMany({
      where: { id: setting.id, OR: [{ lastSentPeriodKey: null }, { lastSentPeriodKey: { not: periodKey } }] },
      data: { lastSentAt: utcNow, lastSentPeriodKey: periodKey },
    });
    if (claim.count === 0) continue;
    try {
      const result = await sendLeaseReminder(setting.tenantId, setting.companyId);
      if (result.sent) sent += 1;
    } catch (err) {
      // خطأ في شركة واحدة لا يوقف بقية الشركات في النبضة نفسها
      // eslint-disable-next-line no-console
      console.error(`[leaseReminderScheduler] فشل إرسال تنبيهات الإيجارات للشركة ${setting.companyId}:`, err);
    }
  }
  return { sent };
}

/** نبضة تُستدعى مرة عند إقلاع الخادم (server.ts) بنمط reportScheduler: أول فحص بعد 5 دقائق ثم كل 5 دقائق. */
export function startLeaseReminderScheduler() {
  const tick = () =>
    runDueLeaseReminders().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[leaseReminderScheduler] فشل الفحص الدوري:", err);
    });
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
