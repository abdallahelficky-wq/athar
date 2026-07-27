import { prisma } from "../../lib/prisma";
import { buildObjectKey, uploadObject, deleteObject, getPresignedGetUrl } from "../../lib/storage";
import { notFound } from "../../lib/httpError";

async function withFreshUrl<T extends { fileKey: string }>(attachment: T) {
  const { fileKey, ...rest } = attachment;
  return { ...rest, fileUrl: await getPresignedGetUrl(fileKey) };
}

export async function listAttachments(tenantId: string, entityType: string, entityId: string) {
  const attachments = await prisma.attachment.findMany({
    where: { tenantId, entityType, entityId },
    orderBy: { uploadedAt: "desc" },
  });
  return Promise.all(attachments.map(withFreshUrl));
}

export async function createAttachment(
  tenantId: string,
  userId: string,
  input: { entityType: string; entityId: string; fileName: string; mimeType: string; buffer: Buffer },
) {
  const key = buildObjectKey(tenantId, input.entityType, input.entityId, input.fileName);
  await uploadObject(key, input.buffer, input.mimeType);

  const attachment = await prisma.attachment.create({
    data: {
      tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: input.fileName,
      fileKey: key,
      fileSize: input.buffer.length,
      mimeType: input.mimeType,
      uploadedBy: userId,
    },
  });
  return withFreshUrl(attachment);
}

export async function deleteAttachment(tenantId: string, id: string) {
  const attachment = await prisma.attachment.findFirst({ where: { id, tenantId } });
  if (!attachment) throw notFound("المرفق غير موجود");
  await deleteObject(attachment.fileKey);
  await prisma.attachment.delete({ where: { id } });
}
