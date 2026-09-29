import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * من نفّذ التعديل — لمُشغِّلات السجل في قاعدة البيانات (account_record_change وأخواتها لاحقاً). المُشغِّل يسجّل التغيير
 * نفسه من أي مسار كان؛ المنفّذ يصله من إعداد المعاملة app.actor_user_id (محلي للمعاملة: set_config(…, true)). مسار لا
 * يضبطه يُسجَّل تعديله بمنفّذ فارغ — «غير مسجَّل» — لا يُنسَب لأحد خطأً ولا يضيع.
 */
export async function setAuditActor(tx: Prisma.TransactionClient, userId: string | null | undefined) {
  if (!userId) return;
  await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${userId}, true)`;
}

/** يشغّل fn داخل معاملة ضُبط فيها المنفّذ — للمسارات التي كانت تعدّل خارج معاملة */
export function withAuditActor<T>(userId: string | null | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setAuditActor(tx, userId);
    return fn(tx);
  });
}
