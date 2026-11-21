import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { currentRequestContext } from "./requestContext";

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

/**
 * المنفّذ لكل كتابة تجري أثناء طلب مستخدم — تلقائياً، بلا الحاجة لاستدعاء setAuditActor في كل مسار:
 * مُشغِّلات السجل (account_record_change، record_row_change…) تقرأ app.actor_user_id من إعداد المعاملة، وهو محلي
 * للمعاملة واتصالها. فيُركَّب هنا مرة واحدة لكل عملية (createApp):
 *  1) $transaction التفاعلية (دالة): أول ما يُنفَّذ داخلها set_config بمستخدم الطلب الحالي (requestContext).
 *  2) $transaction الدفعية (مصفوفة): يُضاف set_config أولها ويُحذف ناتجه من النتيجة.
 *  3) كتابة مفردة خارج أي معاملة على جدول مُراقَب (AUDITED_MODELS): تُنفَّذ داخل معاملة قصيرة يُضبط فيها المنفّذ
 *     أولاً — نفس الكتابة بنفس الوسائط؛ الاستدعاء الداخلي يمرّ بالوسطاء مجدداً بعلامة runInTransaction فلا يُلفّ مرتين.
 * بلا سياق طلب (المُجدوِلات، السكربتات، لوحة المنصة) لا يتغيّر شيء: المنفّذ فارغ «غير مسجَّل» كما كان.
 */
export const AUDITED_MODELS = new Set([
  "SalesInvoice", "SalesInvoiceLine", "PurchaseInvoice", "PurchaseInvoiceLine",
  "SalesReturn", "SalesReturnLine", "PurchaseReturn", "PurchaseReturnLine",
  "SalesDebitNote", "SalesDebitNoteLine", "Receipt", "Customer", "Supplier", "Item", "Account",
]);
const AUDITED_WRITE_ACTIONS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

let actorPropagationInstalled = false;

export function installAuditActorPropagation(client: PrismaClient) {
  if (actorPropagationInstalled) return;
  actorPropagationInstalled = true;

  const originalTransaction = client.$transaction.bind(client) as (...args: unknown[]) => Promise<unknown>;
  (client as unknown as { $transaction: unknown }).$transaction = (arg: unknown, options?: unknown) => {
    const userId = currentRequestContext()?.userId;
    if (!userId) return originalTransaction(arg, options);
    if (typeof arg === "function") {
      const fn = arg as (tx: Prisma.TransactionClient) => Promise<unknown>;
      return originalTransaction(async (tx: Prisma.TransactionClient) => {
        await setAuditActor(tx, userId);
        return fn(tx);
      }, options);
    }
    if (Array.isArray(arg)) {
      const setActor = client.$executeRaw`SELECT set_config('app.actor_user_id', ${userId}, true)`;
      return (originalTransaction([setActor, ...arg], options) as Promise<unknown[]>).then((results) => results.slice(1));
    }
    return originalTransaction(arg, options);
  };

  client.$use(async (params, next) => {
    if (params.runInTransaction || !params.model || !AUDITED_MODELS.has(params.model) || !AUDITED_WRITE_ACTIONS.has(params.action)) {
      return next(params);
    }
    const userId = currentRequestContext()?.userId;
    if (!userId) return next(params);
    const delegateName = params.model.charAt(0).toLowerCase() + params.model.slice(1);
    return originalTransaction(async (tx: Prisma.TransactionClient) => {
      await setAuditActor(tx, userId);
      const delegate = (tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[delegateName];
      return delegate[params.action](params.args);
    });
  });
}

/** هل رُكِّب نشر المنفّذ في هذه العملية؟ (اختبار وجوده يفشل لو سقط التركيب من createApp) */
export function isAuditActorPropagationInstalled(): boolean {
  return actorPropagationInstalled;
}
