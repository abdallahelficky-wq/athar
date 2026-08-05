import puppeteer from "puppeteer-core";
import { env } from "../../../config/env";

// يُصيّر HTML إلى PDF عبر Chromium بلا واجهة (headless) — يعتمد على ثنائي Chromium مثبَّت مسبقاً
// في بيئة التشغيل (env.chromiumExecutablePath) بدل تنزيل نسخة خاصة عبر puppeteer الكامل؛ المسار
// يختلف حسب بيئة النشر فيُضبَط بمتغيّر بيئة، بلا قيمة افتراضية مُخمَّنة. --no-sandbox مطلوب فقط لأن
// الخادم قد يعمل كـ root داخل حاويات؛ ليست مشكلة أمنية هنا لأن المحتوى المُصيَّر ذاتي المصدر بالكامل
// (HTML نولّده نحن، لا محتوى خارجي غير موثوق).

function resolveExecutablePath(): string {
  if (!env.chromiumExecutablePath) {
    throw new Error("متغيّر البيئة CHROMIUM_EXECUTABLE_PATH غير مضبوط — مطلوب مسار Chromium قابل للتنفيذ لتوليد PDF");
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
