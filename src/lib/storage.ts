import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { env } from "../config/env";

const PRESIGNED_URL_TTL_SECONDS = 3600;

let client: S3Client | null = null;

/**
 * عميل S3 موجَّه لحاوية Cloudflare R2 (متوافقة مع S3 API). يُنشأ عند أول استخدام فعلي
 * وليس عند تحميل الوحدة، حتى لا يفشل تشغيل الخادم في بيئة لم تُضبط فيها متغيرات R2 بعد.
 */
function getClient(): S3Client {
  if (client) return client;
  if (!env.r2AccessKeyId || !env.r2SecretAccessKey || !env.r2Endpoint || !env.r2BucketName) {
    throw new Error(
      "التخزين السحابي غير مُهيَّأ: تأكّد من ضبط R2_ACCESS_KEY_ID و R2_SECRET_ACCESS_KEY و R2_ENDPOINT و R2_BUCKET_NAME",
    );
  }
  client = new S3Client({
    region: "auto",
    endpoint: env.r2Endpoint,
    // مسار-نمط (path-style) بدل النمط الافتراضي المستضاف-فرعياً (bucket.endpoint) — مدعوم
    // رسمياً من R2 نفسها، وضروري لأي بديل S3 اختباري محلي (MinIO/s3rver) لا يملك DNS
    // بأسماء نطاقات فرعية لكل حاوية.
    forcePathStyle: true,
    credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey },
  });
  return client;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-؀-ۿ]/g, "_").slice(-120);
}

/** مسار الملف الدائم داخل الحاوية — معزول بالكامل حسب tenantId ونوع/معرّف الكيان المرتبط */
export function buildObjectKey(tenantId: string, entityType: string, entityId: string, fileName: string): string {
  return `${tenantId}/${entityType}/${entityId}/${randomUUID()}-${sanitizeFileName(fileName)}`;
}

export async function uploadObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: env.r2BucketName, Key: key, Body: buffer, ContentType: mimeType }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: key }));
}

/** رابط مؤقت (صالح لساعة واحدة) لعرض/تنزيل الملف — يُولَّد عند كل طلب وليس مخزَّناً بشكل دائم */
export async function getPresignedGetUrl(key: string): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: env.r2BucketName, Key: key }), {
    expiresIn: PRESIGNED_URL_TTL_SECONDS,
  });
}
