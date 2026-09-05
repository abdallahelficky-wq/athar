import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // بلا هذا كان vitest (بلا ملف إعداد سابقاً) يكتشف افتراضياً أي *.spec.js عبر كل المستودع،
    // بما فيها frontend/e2e/*.spec.js (اختبارات Playwright حقيقية عبر متصفح، لا اختبارات vitest) —
    // فيحاول تشغيلها بمحرك vitest نفسه ويفشل فوراً (test.use من Playwright غير موجودة هنا).
    // النطاق هنا مطابق تماماً للنمط الفعلي المستخدَم بالفعل في كل ملفات اختبار الخادم الحالية.
    include: ["src/**/*.test.ts"],
  },
});
