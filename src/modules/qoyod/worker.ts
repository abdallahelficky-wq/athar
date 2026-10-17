import { prisma } from "../../lib/prisma";
import { decryptSecret } from "../../lib/zatca/secretBox";
import { journalPayload, Mapping } from "./payload";
import { qoyodRequest, QoyodFailure } from "./client";

export async function dispatchQoyodJournal() {
  await prisma.qoyodJournalExport.updateMany({ where: { status: "sending", updatedAt: { lt: new Date(Date.now() - 120000) } }, data: { status: "uncertain", error: "انقطع التنفيذ أثناء الإرسال؛ راجع قيود قبل أي إعادة إرسال", updatedAt: new Date() } });
  const candidate = await prisma.qoyodJournalExport.findFirst({ where: { status: "queued", connection: { enabled: true } }, orderBy: { createdAt: "asc" } });
  if (!candidate) return;
  const dispatch = await prisma.$transaction(async tx => {
    // Lock the parent before reading lines; the line guard takes this same lock.
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id=${candidate.entryId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "companyId" FROM qoyod_connections WHERE "companyId"=${candidate.companyId} FOR UPDATE`;
    const job = await tx.qoyodJournalExport.findUnique({ where: { entryId: candidate.entryId }, include: { connection: true, entry: { include: { lines: true, company: true } } } });
    if (!job || job.status !== "queued" || !job.connection.enabled) return null;
    try {
      if (job.entry.companyId !== job.companyId || job.entry.status !== "posted") throw new Error("القيد ليس مرحلًا في الشركة المرتبطة");
      if (job.entry.company.currency !== "SAR") throw new Error("الربط الحالي يدعم قيود الريال السعودي فقط");
      const payload = journalPayload(job.entry, job.connection.mapping as Mapping);
      const key = decryptSecret(job.connection.apiKeyEnc);
      await tx.qoyodJournalExport.update({ where: { entryId: job.entryId }, data: { status: "sending", payload, error: null, updatedAt: new Date() } });
      return { key, payload, entryId: job.entryId };
    } catch (error) {
      await tx.qoyodJournalExport.update({ where: { entryId: job.entryId }, data: { status: "blocked", error: error instanceof Error ? error.message : "تعذر تجهيز القيد", updatedAt: new Date() } });
      return null;
    }
  });
  if (!dispatch) return;
  let remoteId: number;
  try {
    const result = await qoyodRequest(dispatch.key, "journal_entries", dispatch.payload);
    remoteId = result?.id;
    if (!Number.isSafeInteger(remoteId) || remoteId <= 0) throw new QoyodFailure(true);
  } catch (error) {
    await prisma.qoyodJournalExport.update({ where: { entryId: dispatch.entryId }, data: {
      status: error instanceof QoyodFailure && !error.uncertain ? "blocked" : "uncertain",
      error: error instanceof QoyodFailure ? error.message : "نتيجة الإرسال غير مؤكدة؛ راجع قيود",
      updatedAt: new Date(),
    } });
    return;
  }
  // If persistence fails, leave sending; stale detection changes it to uncertain, never re-POST.
  await prisma.qoyodJournalExport.update({ where: { entryId: dispatch.entryId }, data: { status: "sent", remoteId, error: null, updatedAt: new Date() } });
}

export function startQoyodScheduler() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await dispatchQoyodJournal(); } catch { console.error("Qoyod worker failed; pending state retained"); }
    finally { running = false; }
  }, 5000);
  timer.unref();
  return timer;
}
