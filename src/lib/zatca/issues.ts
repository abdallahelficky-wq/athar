import { createHash } from "crypto";
import { gunzipSync, gzipSync } from "zlib";
import { Prisma, ZatcaDocumentIssue, ZatcaSubmissionAttempt } from "@prisma/client";
import { prisma } from "../prisma";
import { notFound } from "../httpError";
import type { ZatcaArchiveDocumentType } from "./archive";
import type { ZatcaChainResult } from "./chain";
import type { ZatcaSubmissionOutcome } from "./submission";
import type { ZatcaSubmissionKind } from "./submission";

/**
 * سجل إصدارات زاتكا وسجل محاولات الإرسال — الجدولان zatca_document_issues وzatca_submission_attempts (للإضافة فقط،
 * مُشغِّل في القاعدة يرفض UPDATE/DELETE/TRUNCATE). راجع ترحيل 20261008092218_zatca_document_issues_and_attempts.
 *
 * - إصدار (issue): كل حجز في سلسلة الشركة (ICV/PIH) — يُكتَب في نفس معاملة الحجز وكتابة صف المستند، فلا ICV محجوز بلا صف هنا.
 *   UUID وICV فريدان في القاعدة نفسها: الدليل الفني لزاتكا (القسم 7) يمنع إعادة استخدامهما بعد الرفض.
 * - محاولة (attempt): كل إرسال فعلي لزاتكا — ملف XML الموقَّع كما أُرسِل، والرد كاملاً، والنتيجة، للمقبول والمرفوض معاً.
 */
type Tx = Prisma.TransactionClient;

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export interface ZatcaDocumentRef {
  tenantId: string;
  companyId: string;
  documentType: ZatcaArchiveDocumentType;
  documentId: string;
  documentNumber: string;
  documentUuid: string;
}

export async function recordZatcaIssueTx(
  tx: Tx,
  doc: ZatcaDocumentRef,
  chain: Pick<ZatcaChainResult, "icv" | "previousInvoiceHash" | "invoiceHash" | "issuedAt" | "xml" | "subtype" | "supplyDate">,
  opts: { userId?: string | null; supplyDate?: string; reissue?: { ofIssueId: string | null } } = {},
) {
  const unsigned = Buffer.from(chain.xml, "utf8");
  return tx.zatcaDocumentIssue.create({
    data: {
      ...doc,
      icv: chain.icv,
      previousInvoiceHash: chain.previousInvoiceHash,
      invoiceHash: chain.invoiceHash,
      subtype: chain.subtype,
      issuedAt: chain.issuedAt,
      supplyDate: opts.supplyDate ?? chain.supplyDate ?? null,
      reissueOfIssueId: opts.reissue?.ofIssueId ?? null,
      compression: "gzip",
      unsignedXml: gzipSync(unsigned),
      unsignedXmlSha256: sha256(unsigned),
      source: opts.reissue ? "reissue" : "issue",
      createdById: opts.userId ?? null,
    },
    select: { id: true },
  });
}

/** KSA-5 كما حُجز به المستند الحالي (مُعرَّف فقط لمستند أُعيد إصداره) — تحتاجه إعادة البناء لتطابق التجزئة المخزَّنة */
export async function issuedSupplyDate(companyId: string, documentUuid: string): Promise<string | undefined> {
  const issue = await prisma.zatcaDocumentIssue.findFirst({ where: { companyId, documentUuid }, select: { supplyDate: true } });
  return issue?.supplyDate ?? undefined;
}

/** ما يلزم لتسجيل محاولة إرسال — يحمله قرار البوابة (postingGate.ts) ونتيجة إعادة الإرسال (resubmit.ts) */
export interface ZatcaAttemptPayload {
  submissionKind: ZatcaSubmissionKind;
  outcome: string;
  icv: number;
  invoiceHash: string;
  signedXml: string | null;
  httpStatus: number | null;
  response: unknown;
  reason: string | null;
}

export function attemptFromOutcome(
  outcome: ZatcaSubmissionOutcome,
  submissionKind: ZatcaSubmissionKind,
  status: string,
  chain: { icv: number; invoiceHash: string },
): ZatcaAttemptPayload {
  return {
    submissionKind,
    outcome: status,
    icv: chain.icv,
    invoiceHash: chain.invoiceHash,
    signedXml: outcome.signedXml || null,
    httpStatus: outcome.accepted ? null : outcome.httpStatus ?? null,
    response: outcome.response ?? null,
    reason: outcome.accepted ? null : outcome.reason,
  };
}

export async function writeZatcaAttemptTx(
  tx: Tx,
  doc: ZatcaDocumentRef,
  attempt: ZatcaAttemptPayload,
  source: "submission" | "resubmission",
  userId: string | null | undefined,
) {
  const signed = attempt.signedXml ? Buffer.from(attempt.signedXml, "utf8") : null;
  await tx.zatcaSubmissionAttempt.create({
    data: {
      ...doc,
      icv: attempt.icv,
      invoiceHash: attempt.invoiceHash,
      submissionKind: attempt.submissionKind,
      outcome: attempt.outcome,
      httpStatus: attempt.httpStatus,
      compression: "gzip",
      signedXml: signed ? gzipSync(signed) : null,
      signedXmlSha256: signed ? sha256(signed) : null,
      response: attempt.response == null ? Prisma.JsonNull : (attempt.response as Prisma.InputJsonValue),
      reason: attempt.reason,
      source,
      userId: userId ?? null,
    },
  });
}

/** سجل الإصدارات والمحاولات لمستند واحد — للعرض (بلا ملفات XML؛ تُنزَّل منفصلة عبر getZatcaAttemptSignedXml) */
export async function getZatcaDocumentHistory(tenantId: string, documentType: ZatcaArchiveDocumentType, documentId: string) {
  const [issues, attempts] = await Promise.all([
    // Historical tenant IDs are immutable; current company ownership authorizes reads.
    prisma.$queryRaw<Pick<ZatcaDocumentIssue, "id" | "documentNumber" | "documentUuid" | "icv" | "previousInvoiceHash" | "invoiceHash" | "subtype" | "issuedAt" | "supplyDate" | "reissueOfIssueId" | "source" | "createdById" | "createdAt">[]>(Prisma.sql`
      SELECT a.id,a."documentNumber",a."documentUuid",a.icv,a."previousInvoiceHash",a."invoiceHash",a.subtype,
        a."issuedAt",a."supplyDate",a."reissueOfIssueId",a.source,a."createdById",a."createdAt"
      FROM zatca_document_issues a JOIN companies c ON c.id=a."companyId"
      WHERE c."tenantId"=${tenantId} AND a."documentType"=${documentType} AND a."documentId"=${documentId}
      ORDER BY a.icv ASC
    `),
    prisma.$queryRaw<Pick<ZatcaSubmissionAttempt, "id" | "documentUuid" | "icv" | "invoiceHash" | "submissionKind" | "outcome" | "httpStatus" | "signedXmlSha256" | "response" | "reason" | "source" | "userId" | "attemptedAt">[]>(Prisma.sql`
      SELECT a.id,a."documentUuid",a.icv,a."invoiceHash",a."submissionKind",a.outcome,a."httpStatus",
        a."signedXmlSha256",a.response,a.reason,a.source,a."userId",a."attemptedAt"
      FROM zatca_submission_attempts a JOIN companies c ON c.id=a."companyId"
      WHERE c."tenantId"=${tenantId} AND a."documentType"=${documentType} AND a."documentId"=${documentId}
      ORDER BY a."attemptedAt" ASC
    `),
  ]);
  return {
    issues,
    attempts: attempts.map(({ signedXmlSha256, ...a }) => ({ ...a, signedXmlSha256, hasSignedXml: Boolean(signedXmlSha256) })),
  };
}

/** ملف XML الموقَّع كما أُرسِل في محاولة واحدة — مقيَّد بالمستأجر والمستند معاً */
export async function getZatcaAttemptSignedXml(tenantId: string, documentType: ZatcaArchiveDocumentType, documentId: string, attemptId: string) {
  const [attempt] = await prisma.$queryRaw<Pick<ZatcaSubmissionAttempt, "signedXml" | "compression" | "documentNumber" | "icv" | "documentUuid">[]>(Prisma.sql`
    SELECT a."signedXml",a.compression,a."documentNumber",a.icv,a."documentUuid"
    FROM zatca_submission_attempts a JOIN companies c ON c.id=a."companyId"
    WHERE c."tenantId"=${tenantId} AND a.id=${attemptId}
      AND a."documentType"=${documentType} AND a."documentId"=${documentId}
    LIMIT 1
  `);
  if (!attempt?.signedXml) throw notFound("لا يوجد ملف XML موقَّع محفوظ لهذه المحاولة");
  const buf = Buffer.from(attempt.signedXml);
  const xml = attempt.compression === "gzip" ? gunzipSync(buf) : buf;
  return { xml, fileName: `${attempt.documentNumber}_ICV${attempt.icv}_${attempt.documentUuid}.xml` };
}
