import { prisma } from "./prisma";
import { sendLeaseReminder } from "../modules/leaseContracts/leaseContracts.service";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة — كجدولة التقارير؛ أدق حبيبة هي ساعة hourKsa
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // توقيت السعودية ثابت UTC+3 بلا توقيت صيفي

/**
 * يرسل بريد تنبيهات الإيجارات للشركات التي فعّلته وحان موعدها اليوم (ساعة السعودية ≥ hourKsa) ولم يُرسَل لها اليوم. المطالبة
 * باليوم ذرّية قبل الإرسال (شرط على lastSentPeriodKey في UPDATE نفسه) — نسختان من الخادم أو نبضتان متداخلتان لا ترسلان مرتين.
 * اليوم يُطالَب به حتى إن لم يوجد ما يُنبَّه عليه أو فشل الإرسال: تفادي التكرار أهم، و«إرسال الآن» بديل يدوي.
 */
export async function runDueLeaseReminders(utcNow: Date = new Date()) {
  const shifted = new Date(utcNow.getTime() + KSA_OFFSET_MS);
  const hour = shifted.getUTCHours();
  const periodKey = shifted.toISOString().slice(0, 10);
  const settings = await prisma.leaseReminderSetting.findMany({ where: { enabled: true, hourKsa: { lte: hour } } });
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

/** نبضة ساعية تُستدعى مرة عند إقلاع الخادم (server.ts) بنمط reportScheduler: أول فحص بعد 5 دقائق ثم كل ساعة. */
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
