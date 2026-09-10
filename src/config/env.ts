import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`متغير البيئة المطلوب غير موجود: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "30d",
  // سرّ توقيع منفصل تماماً عن حسابات User الإدارية — يضمن أن رمز بوابة الموظف لا يمكن التحقق
  // منه أبداً كرمز مستخدم إداري (وبالعكس) حتى لو تطابقت بنية الحمولة (payload) صدفةً.
  // له قيمة افتراضية آمنة للتطوير المحلي فقط؛ يجب ضبط JWT_EMPLOYEE_PORTAL_SECRET صراحةً في الإنتاج.
  jwtEmployeePortalSecret: required("JWT_EMPLOYEE_PORTAL_SECRET", `${required("JWT_ACCESS_SECRET")}::employee-portal`),
  jwtEmployeePortalExpiresIn: process.env.JWT_EMPLOYEE_PORTAL_EXPIRES_IN ?? "7d",
  defaultUnlockPin: process.env.DEFAULT_UNLOCK_PIN ?? "1234",

  // اختيارية: تُقرأ عند الاستخدام الفعلي فقط (رفع مرفق / إنشاء قيد من مستند)، وليس عند بدء
  // تشغيل الخادم، حتى يعمل باقي النظام بشكل طبيعي في بيئة تطوير لم تُضبط فيها بعد.
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2Endpoint: process.env.R2_ENDPOINT,
  r2BucketName: process.env.R2_BUCKET_NAME,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",

  // اختياري: بدون مفتاح، يكتفي lib/mailer.ts بطباعة محتوى الإيميل في الطرفية (fallback آمن
  // للتطوير المحلي) بدل الإرسال الفعلي عبر Resend.
  // اختياري: مفتاح تشفير أسرار ربط زاتكا (CSID) — Base64 لـ 32 بايت (256 بت)، يُقرأ فقط عند
  // الاستخدام الفعلي (src/lib/zatca/secretBox.ts)، وليس عند بدء تشغيل الخادم، بنفس أسلوب مفاتيح
  // R2/Anthropic أعلاه — حتى يعمل باقي النظام طبيعياً في بيئة لم تُفعَّل فيها ميزة زاتكا بعد.
  zatcaEncryptionKey: process.env.ZATCA_ENCRYPTION_KEY,
  // اختياري: مسار ثنائي Chromium قابل للتنفيذ، مطلوب فقط عند توليد PDF/A-3 لفواتير زاتكا فعلياً
  // (src/lib/zatca/pdf/renderPdf.ts) — يختلف حسب بيئة النشر، لا قيمة افتراضية آمنة عالمياً.
  chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH,

  // اختياري: سرّ مشترك تتحقق منه src/middleware/auth.ts's authenticatePlatformService لكل طلب
  // على /api/platform-admin/* — يُستخدَمه فقط تطبيق "athar-platform-admin" المنفصل تماماً (مستودع
  // كود وقاعدة بيانات مستقلَّين) للتحكم بالاشتراكات/الموديولات/الإشعارات من خارج هذا النظام. بلا
  // اتصال مباشر بقاعدة البيانات بين النظامين إطلاقاً — هذا المفتاح هو حدود الثقة الوحيدة بينهما.
  // بدونه، مسارات /api/platform-admin/* ترفض كل الطلبات (fail closed، لا fallback مطلقاً).
  platformAdminApiKey: process.env.PLATFORM_ADMIN_API_KEY,

  resendApiKey: process.env.RESEND_API_KEY,
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? "أثر المحاسبي <onboarding@resend.dev>",
  // أساس الروابط الموجودة داخل الإيميلات (رابط إعادة تعيين كلمة المرور، رابط قبول الدعوة)؛
  // يجب أن يشير لأصل الواجهة الأمامية المنشورة فعلياً، لا الخادم الخلفي.
  frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? "https://athar-accounting.up.railway.app",
};
