import { prisma } from "../../lib/prisma";

/**
 * حدّ محاولات الدخول الفاشلة لبوابة الموظف لكل عنوان IP — نافذة ثابتة مدتها 15 دقيقة، مخزَّنة في
 * قاعدة البيانات (portal_login_throttle) لا في ذاكرة العملية، حتى يبقى الحدّ صحيحاً مع أكثر من نسخة
 * خادم. تُحسَب المحاولات الفاشلة فقط: عمّال محطة واحدة غالباً خلف IP واحد (شبكة المحطة أو NAT مشغّل
 * الجوال)، فلا يُعاقَب دخولهم الناجح المتكرر. يكمّل قفل الحساب لكل موظف (employeePortal.service.ts):
 * القفل يحمي رقماً بعينه، وهذا الحدّ يمنع تجربة أرقام/رموز منشآت كثيرة من المصدر نفسه.
 */
export const IP_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_IP = 20;
const CLEANUP_AFTER_MS = 24 * 60 * 60_000;

const keyFor = (ip: string) => `ip:${ip}`;

export async function isIpThrottled(ip: string, now = new Date()): Promise<boolean> {
  const row = await prisma.portalLoginThrottle.findUnique({ where: { key: keyFor(ip) } });
  if (!row) return false;
  if (row.windowStart.getTime() <= now.getTime() - IP_WINDOW_MS) return false;
  return row.failures >= MAX_FAILURES_PER_IP;
}

export async function recordIpFailure(ip: string, now = new Date()): Promise<void> {
  const key = keyFor(ip);
  const windowFloor = new Date(now.getTime() - IP_WINDOW_MS);

  // داخل النافذة الحالية: زيادة ذرّية في قاعدة البيانات (لا قراءة ثم كتابة).
  const bumped = await prisma.portalLoginThrottle.updateMany({
    where: { key, windowStart: { gt: windowFloor } },
    data: { failures: { increment: 1 } },
  });
  if (bumped.count === 0) {
    // لا صف بعد أو انتهت نافذته: نافذة جديدة تبدأ الآن بمحاولة فاشلة واحدة.
    try {
      await prisma.portalLoginThrottle.upsert({
        where: { key },
        create: { key, windowStart: now, failures: 1 },
        update: { windowStart: now, failures: 1 },
      });
    } catch {
      // طلب متزامن أنشأ الصف في اللحظة نفسها — نزيد عليه بدل الكتابة فوقه.
      await prisma.portalLoginThrottle.updateMany({ where: { key }, data: { failures: { increment: 1 } } });
    }
  }

  // تنظيف عرضي للصفوف القديمة جداً — لا يستحق مهمة مجدولة منفصلة.
  if (Math.random() < 0.02) {
    await prisma.portalLoginThrottle.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - CLEANUP_AFTER_MS) } } });
  }
}
