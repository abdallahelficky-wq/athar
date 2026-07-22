import { Prisma, PrismaClient, SourceModule } from "@prisma/client";
import { prisma } from "./prisma";
import { verifyPassword } from "./password";
import { forbidden } from "./httpError";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface PostingLine {
  accountId: string;
  costCenterId?: string | null;
  department?: string | null;
  debit: number;
  credit: number;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
}

export interface CreateEntryInput {
  tenantId: string;
  companyId: string;
  date: Date;
  memo?: string;
  sourceModule: SourceModule;
  sourceId?: string;
  createdBy?: string;
  lines: PostingLine[];
}

/**
 * ينشئ قيداً محاسبياً مرحّلاً (status: posted) من أسطر جاهزة — يُستخدَم من كل موديولات
 * المصادر (فواتير، سندات، رواتب، إهلاك...) عوضاً عن تكرار نفس منطق الإنشاء في كل موديول.
 * لا يتحقق من توازن المدين/الدائن هنا لأن كل موديول يبني أسطره بشكل متوازن رياضياً
 * بالتصميم (مطابقةً لمنطق الواجهة المرجعية)؛ التحقق الصارم موجود فقط في القيود اليدوية
 * الحرة الشكل (journalEntries.service.ts) حيث يُدخل المستخدم الأرقام يدوياً.
 */
export async function createJournalEntryTx(tx: Tx, input: CreateEntryInput) {
  return tx.journalEntry.create({
    data: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: input.memo,
      status: "posted",
      sourceModule: input.sourceModule,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId || null,
          department: l.department || null,
          debit: new Prisma.Decimal(l.debit || 0),
          credit: new Prisma.Decimal(l.credit || 0),
          customerId: l.customerId || null,
          supplierId: l.supplierId || null,
          employeeId: l.employeeId || null,
        })),
      },
    },
  });
}

/** يحذف القيد المرتبط بمعاملة مصدر (فاتورة/سند/...) عند فك ترحيلها، وفق القسم 4.9 */
export async function deleteJournalEntryTx(tx: Tx, journalEntryId: string | null | undefined) {
  if (!journalEntryId) return;
  await tx.journalEntry.deleteMany({ where: { id: journalEntryId } });
}

/** يتحقق من الرقم السري لفك الترحيل الخاص بالمستأجر، ويرمي خطأ 403 إن كان خاطئاً */
export async function assertValidUnlockPin(tenantId: string, pin: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const valid = await verifyPassword(pin, tenant.unlockPin);
  if (!valid) throw forbidden("الرقم السري غير صحيح");
}

/** يسجّل حدث فك ترحيل في سجل التدقيق (audit log) وفق ما يطلبه القسم 4.9 صراحة */
export async function writeUnpostAuditLogTx(
  tx: Tx,
  params: { tenantId: string; userId: string; entityType: string; entityId: string; metadata?: Record<string, unknown> },
) {
  await tx.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: `${params.entityType.toLowerCase()}.unpost`,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as Prisma.InputJsonValue,
    },
  });
}
