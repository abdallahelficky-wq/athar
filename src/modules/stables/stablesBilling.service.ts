import { Prisma } from "@prisma/client";
import { badRequest } from "../../lib/httpError";
import { createJournalEntryTx, deleteJournalEntryTx } from "../../lib/journalPosting";

export async function accrueTrainerCommissionsTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  salesInvoiceId: string,
  userId: string,
) {
  const billing = await tx.horseBoardingInvoice.findUnique({
    where: { salesInvoiceId },
    include: { lines: { include: { service: true } } },
  });
  const lesson = billing ? null : await tx.ridingLesson.findFirst({ where: { salesInvoiceId, tenantId, companyId } });
  if (!billing && !lesson) return;

  const grouped = new Map<string, { trainerId: string; horseId: string | null; lessonId: string | null; net: number; sourceType: string }>();
  if (billing) {
    const trainingLines = billing.lines.filter((line) => line.trainerId && ["training", "competition"].includes(line.service.category));
    for (const line of trainingLines) {
      const key = `${line.trainerId}:${line.horseId}`;
      const current = grouped.get(key) || { trainerId: line.trainerId!, horseId: line.horseId, lessonId: null, net: 0, sourceType: "horse_training" };
      current.net += Number(line.netAmount);
      grouped.set(key, current);
    }
  } else if (lesson) {
    const invoice = await tx.salesInvoice.findUniqueOrThrow({ where: { id: salesInvoiceId }, select: { subtotal: true } });
    grouped.set(`lesson:${lesson.id}`, { trainerId: lesson.trainerId, horseId: lesson.horseId, lessonId: lesson.id, net: Number(invoice.subtotal), sourceType: "riding_lesson" });
  }
  if (!grouped.size) return;
  const trainerIds = [...new Set([...grouped.values()].map((row) => row.trainerId))];
  const trainers = await tx.ridingTrainer.findMany({ where: { id: { in: trainerIds }, tenantId, companyId, isActive: true } });
  if (trainers.length !== trainerIds.length) throw badRequest("أحد المدربين المحددين غير موجود أو غير فعال");
  const trainerById = new Map(trainers.map((trainer) => [trainer.id, trainer]));
  const commissions = [...grouped.values()].map((row) => {
    const pct = Number(trainerById.get(row.trainerId)!.commissionPct);
    return { ...row, pct, amount: Math.round(row.net * pct) / 100 };
  }).filter((row) => row.amount > 0);
  if (!commissions.length) return;

  const [expenseAccount, payableAccount] = await Promise.all([
    tx.account.findFirst({ where: { tenantId, companyId, code: "511007", isPosting: true, isActive: true, isArchived: false } }),
    tx.account.findFirst({ where: { tenantId, companyId, code: "212005", isPosting: true, isActive: true, isArchived: false } }),
  ]);
  if (!expenseAccount || !payableAccount) throw badRequest("أكمل حسابي عمولات المدربين (511007) والعمولات المستحقة (212005) في شجرة الحسابات قبل الترحيل");
  const total = commissions.reduce((sum, row) => sum + row.amount, 0);
  const periodStart = billing ? new Date(billing.billingMonth) : new Date(lesson!.scheduledAt);
  const periodEnd = billing ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0, 23, 59, 59)) : new Date(lesson!.scheduledAt);
  const entry = await createJournalEntryTx(tx, {
    tenantId, companyId, date: periodEnd,
    memo: billing ? `استحقاق عمولات المدربين عن ${periodStart.toISOString().slice(0, 7)}` : `استحقاق عمولة حصة ${lesson!.studentName}`,
    sourceModule: "sales_invoice", sourceId: salesInvoiceId, createdBy: userId,
    lines: [
      { accountId: expenseAccount.id, debit: total, credit: 0 },
      { accountId: payableAccount.id, debit: 0, credit: total },
    ],
  });
  await tx.trainerCommission.createMany({ data: commissions.map((row) => ({
    tenantId, companyId, trainerId: row.trainerId, horseId: row.horseId, lessonId: row.lessonId, sourceType: row.sourceType, salesInvoiceId,
    periodStart, periodEnd, netTrainingRevenue: row.net, commissionPct: row.pct,
    commissionAmount: row.amount, accrualJournalEntryId: entry.id,
  })) });
}

export async function reverseTrainerCommissionsTx(tx: Prisma.TransactionClient, salesInvoiceId: string) {
  const rows = await tx.trainerCommission.findMany({ where: { salesInvoiceId } });
  if (!rows.length) return;
  if (rows.some((row) => row.status === "paid")) throw badRequest("لا يمكن فك ترحيل الفاتورة بعد تسجيل صرف عمولة مدرب مرتبطة بها");
  const entryIds = [...new Set(rows.map((row) => row.accrualJournalEntryId).filter((id): id is string => Boolean(id)))];
  await tx.trainerCommission.deleteMany({ where: { salesInvoiceId } });
  for (const entryId of entryIds) await deleteJournalEntryTx(tx, entryId);
}
