import puppeteer from "puppeteer-core";
import { env } from "../../../config/env";
import { serviceUnavailable } from "../../httpError";

// يُصيّر HTML إلى PDF عبر Chromium بلا واجهة (headless) — يعتمد على ثنائي Chromium مثبَّت مسبقاً
// في بيئة التشغيل (env.chromiumExecutablePath) بدل تنزيل نسخة خاصة عبر puppeteer الكامل؛ المسار
// يختلف حسب بيئة النشر فيُضبَط بمتغيّر بيئة، بلا قيمة افتراضية مُخمَّنة. --no-sandbox مطلوب فقط لأن
// الخادم قد يعمل كـ root داخل حاويات؛ ليست مشكلة أمنية هنا لأن المحتوى المُصيَّر ذاتي المصدر بالكامل
// (HTML نولّده نحن، لا محتوى خارجي غير موثوق).

// خطأ إعداد خادم (لا خطأ من المستخدم، ولا خطأ داخلي غامض) — يُرمى كـ serviceUnavailable (503) لا
// Error خام، حتى يصل errorHandler.ts رسالة صريحة تسمّي المشكلة الفعلية للمستخدم بدل الرسالة
// العامة "خطأ داخلي في الخادم" التي كانت تُخفي هذا التحذير تماماً عن أي طرف عدا سجلات الخادم.
function resolveExecutablePath(): string {
  if (!env.chromiumExecutablePath) {
    throw serviceUnavailable(
      "تعذّر توليد PDF — مشكلة إعداد في الخادم (محرّك PDF غير مُهيَّأ، لا خطأ في بياناتك). راجع الدعم الفني.",
    );
  }
  return env.chromiumExecutablePath;
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
