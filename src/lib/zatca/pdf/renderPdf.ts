import { existsSync } from "fs";
import puppeteer from "puppeteer-core";
import { env } from "../../../config/env";
import { serviceUnavailable } from "../../httpError";

// يُصيّر HTML إلى PDF عبر Chromium بلا واجهة (headless) — يعتمد على ثنائي Chromium مثبَّت مسبقاً
// في بيئة التشغيل بدل تنزيل نسخة خاصة عبر puppeteer الكامل. --no-sandbox مطلوب فقط لأن الخادم قد
// يعمل كـ root داخل حاويات؛ ليست مشكلة أمنية هنا لأن المحتوى المُصيَّر ذاتي المصدر بالكامل (HTML
// نولّده نحن، لا محتوى خارجي غير موثوق).

// عطل إنتاج فعلي مؤكَّد (راجع تقرير التحقيق في فرع fix/pdf-chromium-production): nixpacks.toml
// كان يُعلن تثبيت حزمة chromium، لكن Railway توقّف عن استخدام Nixpacks فعلياً لبناء هذه الخدمة
// (تحوَّل افتراضياً لـRailpack، الذي لا يقرأ nixpacks.toml إطلاقاً — راجع railpack.json الجديد
// بجذر المستودع للإصلاح الفعلي) — فلم يُثبَّت Chromium قط، وCHROMIUM_EXECUTABLE_PATH لم يكن
// مضبوطاً في متغيّرات Railway أصلاً، فكان resolveExecutablePath القديمة (تفحص هذا المتغيّر فقط،
// بلا أي بديل) ترفض فوراً بلا أي احتمال نجاح.
//
// المسارات المعروفة أدناه هي احتياط تلقائي إضافي (لا بديل عن railpack.json — ذاك ما يُثبِّت
// Chromium أصلاً) حتى لا يتكرر نفس العطل الصامت لو تغيّر مسار التثبيت مستقبلاً (توزيعة أساس مختلفة،
// اسم حزمة مختلف) بلا حاجة لتذكّر تحديث متغيّر بيئة يدوياً في كل مرة. "chromium" على Debian
// (bookworm، أساس صور Railpack/Nixpacks القياسي لـNode) يُثبِّت الثنائي في /usr/bin/chromium
// تحديداً — الأسماء الأخرى احتياط لتوزيعات/حزم مختلفة (Alpine "chromium" يُثبِّت بنفس الاسم أيضاً
// أحياناً باسم مختلف قليلاً، أو Google Chrome الكامل بدل Chromium مفتوح المصدر).
const KNOWN_CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

// خطأ إعداد خادم (لا خطأ من المستخدم، ولا خطأ داخلي غامض) — يُرمى كـ serviceUnavailable (503) لا
// Error خام، حتى يصل errorHandler.ts رسالة صريحة تسمّي المشكلة الفعلية للمستخدم بدل الرسالة
// العامة "خطأ داخلي في الخادم" التي كانت تُخفي هذا التحذير تماماً عن أي طرف عدا سجلات الخادم.
//
// CHROMIUM_EXECUTABLE_PATH (إن ضُبط ويُشير فعلياً لمسار موجود) يبقى الأولوية دائماً — تجاوز صريح
// لأي بيئة تحتاج مساراً غير قياسي؛ خلاف ذلك (غير مضبوط، أو مضبوط بمسار لم يعد موجوداً) تُفحَص
// المسارات المعروفة أعلاه بالترتيب تلقائياً قبل الاستسلام.
function resolveExecutablePath(): string {
  if (env.chromiumExecutablePath && existsSync(env.chromiumExecutablePath)) {
    return env.chromiumExecutablePath;
  }
  const knownPath = KNOWN_CHROMIUM_PATHS.find((path) => existsSync(path));
  if (knownPath) return knownPath;
  throw serviceUnavailable(
    "تعذّر توليد PDF — مشكلة إعداد في الخادم (محرّك PDF غير مُهيَّأ، لا خطأ في بياناتك). راجع الدعم الفني.",
  );
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: resolveExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // "load" فقط تكفي: المحتوى ذاتي المصدر بالكامل (CSS مضمَّن، صور QR كـ data: URI) بلا أي طلبات
    // شبكة خارجية تنتظرها networkidle — وهي أصلاً غير مدعومة في واجهة setContent هنا.
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "a4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
