import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// عطل صامت أخطر من "خطوط مربّعة فارغة" (tofu) — أثبتناه تجريبياً أثناء مراجعة فرع
// fix/pdf-chromium-production: حاوية بها Chromium يعمل فعلياً (يُقلِع، يُصيِّر، لا يرمي أي خطأ)
// لكن بلا أي خط يغطي العربية مثبَّت تُنتِج PDF صالحاً تماماً من الناحية التقنية، فارغاً بصرياً
// بالكامل (صفحة بيضاء، لا حتى مربّعات tofu) — لأن Chromium لا يملك أي بيانات خط ليرسم بها أصلاً.
// فحص إقلاع Chromium ونجاح renderHtmlToPdf وحده (raiseChromiumSelfTest في server.ts) **لا يكتشف
// هذه الحالة إطلاقاً** لأنها لا تفشل ولا ترمي — الصفحة الفارغة "نجاح" تام من منظور استدعاء الدالة.
// fc-list :lang=ar هو الفحص المباشر الوحيد لوجود خط يغطي العربية فعلياً، بمعزل عن نجاح Chromium
// نفسه من عدمه.
//
// يُعامَل عدم توفّر fc-list نفسها (أداة fontconfig قد لا تكون مثبَّتة في بعض الصور) كـ"لا دليل على
// وجود خط عربي" تحفظياً — بلا افتراض تفاؤلي بلا دليل، بنفس فلسفة resolveExecutablePath في
// renderPdf.ts (لا قيمة افتراضية مُخمَّنة عند غياب اليقين).
export async function hasArabicCapableFont(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("fc-list", [":lang=ar"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
