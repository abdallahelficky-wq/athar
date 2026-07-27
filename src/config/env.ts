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
};
