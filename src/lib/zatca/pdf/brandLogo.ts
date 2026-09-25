import { readFileSync } from "fs";
import { join } from "path";

// شعار أثر الأفقي (علامة أثر التجارية نفسها — لا شعار الشركة المستخدِمة، الذي له حقله الخاص
// companyLogoDataUrl أصلاً) يُقرَأ مرة واحدة فقط عند تحميل هذه الوحدة ويُحوَّل Base64، لا في كل
// استدعاء توليد PDF — نفس الصورة الثابتة تُستخدَم في كل مستند بصرف النظر عن الشركة/الفاتورة.
// المسار نسبي لجذر المستودع (process.cwd()) لأن npm start/dev/test تُشغَّل كلها من الجذر مباشرة
// (dist/server.js لا يُشغَّل من داخل dist/ نفسه — راجع "start" في package.json الذي يعتمد أصلاً على
// وجود prisma/migrations نسبياً من نفس الجذر، فبنية المستودع الكاملة متاحة وقت التشغيل لا dist/ فقط).
// فشل القراءة (مثلاً نشر لا يتضمن مجلد assets/ لأي سبب) يُعامَل بتدهور رشيق — PDF بلا شعار أثر، لا
// تعطّل توليد الفاتورة بالكامل لعنصر تجميلي بحت.
const LOGO_PATH = join(process.cwd(), "assets", "brand", "generated", "athar-logo-horizontal-pdf.png");

function loadAtharBrandLogoDataUrl(): string | null {
  try {
    const bytes = readFileSync(LOGO_PATH);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`تعذّرت قراءة شعار أثر لتضمينه في PDF (${LOGO_PATH}) — سيُصدَر المستند بلا شعار.`);
    return null;
  }
}

export const ATHAR_BRAND_LOGO_DATA_URL = loadAtharBrandLogoDataUrl();
