import { createHash } from "crypto";
import { deflateRawSync, gunzipSync, gzipSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeZatcaAttemptTx, type ZatcaAttemptPayload } from "./issues";

/**
 * أرشيف مستندات زاتكا (zatca_document_archive) — راجع docs/zatca-archive.md.
 *
 * لماذا: ملف XML الموقَّع الذي نرسله لا يمكن إعادة إنتاجه (توقيع ECDSA عشوائي، ووقت التوقيع والشهادة يتغيّران)،
 * وبوابة فاتورة لا تتيح استرجاع أي مستند مُرسَل. فالنسخة المحفوظة هنا لحظة القبول هي الأصل الوحيد.
 *
 * ما يُحفَظ: كل مستند قبلته زاتكا على مسار الإنتاج (مُخلَّص أو مُبلَّغ عنه) — ملف XML الموقَّع الذي أرسلناه دائماً،
 * وملف XML المُخلَّص الذي أعادته زاتكا للقياسي. فحص الامتثال (شهادة الاختبار) ليس إصداراً قانونياً فلا يُحفَظ.
 * يُكتَب في نفس معاملة حفظ ردّ زاتكا الناجح (writeZatcaArchiveTx) — لا حالة "مقبول" بلا أصل محفوظ.
 */
export type ZatcaArchiveDocumentType = "sales_invoice" | "sales_return" | "sales_debit_note";

/** ما يلزم من نتيجة إرسال مقبول على مسار الإنتاج — يحمله قرار البوابة وقرار إعادة الإرسال */
export interface ZatcaArchivePayload {
  signedXml: string;
  /** base64 كما أعادته زاتكا (القياسي فقط) */
  clearedInvoiceBase64?: string;
  subtype: "standard" | "simplified";
  icv: number;
  invoiceHash: string;
  issuedAt: Date;
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * يفكّ base64 الذي أعادته زاتكا بصرامة: Buffer.from(…, "base64") في Node لا يرمي أبداً ويُرجع بايتات عشوائية لأي
 * نص، فيُحفَظ الهراء "مستنداً قانونياً" ويُصدَّر بدل الأصل الموقَّع. يُقبَل فقط base64 قياسي صالح يُفكّ إلى ما يبدأ
 * (بعد BOM والمسافات) بـ"<" — نفس شرط zatca_archive_try_decode_base64 في ترحيل الاستكمال الرجعي. غير ذلك: null.
 */
export function decodeClearedXml(b64: string | undefined | null): Buffer | null {
  if (typeof b64 !== "string") return null;
  const compact = b64.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const buf = Buffer.from(compact, "base64");
  if (buf.toString("base64") !== compact) return null;
  let i = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  while (i < buf.length && (buf[i] === 9 || buf[i] === 10 || buf[i] === 13 || buf[i] === 32)) i++;
  return i < buf.length && buf[i] === 0x3c ? buf : null;
}

/** الجزء الجذري من مستند UBL بلا <ext:UBLExtensions> — التوقيع وختم زاتكا يحملان عناصر cbc:ID وغيرها داخلها */
function withoutExtensions(xml: string) {
  return xml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "");
}

/** الرقم الضريبي للبائع كما في المستند (cac:AccountingSupplierParty ← cac:PartyTaxScheme ← cbc:CompanyID) */
export function sellerVatFromXml(xml: string): string | null {
  const supplier = withoutExtensions(xml).match(/<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/);
  const scheme = supplier?.[1].match(/<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID>([^<]+)<\/cbc:CompanyID>/);
  return scheme ? scheme[1].trim() : null;
}

export async function writeZatcaArchiveTx(
  tx: Prisma.TransactionClient,
  doc: { tenantId: string; companyId: string; documentType: ZatcaArchiveDocumentType; documentId: string; documentNumber: string; documentUuid: string },
  payload: ZatcaArchivePayload,
  source: "submission" | "resubmission",
) {
  const signed = Buffer.from(payload.signedXml, "utf8");
  const cleared = decodeClearedXml(payload.clearedInvoiceBase64);
  if (payload.clearedInvoiceBase64 && !cleared) {
    // eslint-disable-next-line no-console
    console.error(`[zatca-archive] clearedInvoice من زاتكا ليس base64 صالحاً لمستند XML — ${doc.documentType} ${doc.documentNumber}؛ يُحفَظ الموقَّع وحده`);
  }
  await tx.zatcaDocumentArchive.create({
    data: {
      ...doc,
      icv: payload.icv,
      invoiceHash: payload.invoiceHash,
      subtype: payload.subtype,
      submissionKind: payload.subtype === "standard" ? "clearance" : "reporting",
      issuedAt: payload.issuedAt,
      sellerVatNumber: sellerVatFromXml(payload.signedXml),
      compression: "gzip",
      signedXml: gzipSync(signed),
      signedXmlSha256: sha256(signed),
      clearedXml: cleared ? gzipSync(cleared) : null,
      clearedXmlSha256: cleared ? sha256(cleared) : null,
      source,
    },
  });
}

/**
 * يحفظ ردّ زاتكا المقبول وأصل المستند في معاملة واحدة. لو فشلت (كتابة الأرشيف، أو بدء المعاملة/إنهاؤها تحت ضغط
 * الاتصالات) لا نُسقِط ردّ زاتكا معها: فقدان الرد هو الحادثة الأصلية التي بُني لأجلها الترحيل على ثلاث مراحل (إعادة
 * الإرسال بنفس UUID تكسر سلسلة ICV/التجزئة). يُحفَظ الرد وحده (plain) أولاً، ثم محاولة واحدة مستقلة لكتابة الأرشيف
 * (الأصل الموقَّع موجود في الذاكرة فقط — لا فرصة ثانية بعد هذه الدالة). إن فشلت أيضاً يُسجَّل بصوت عالٍ، ويظهر
 * المستند في عدّاد "مقبول بلا أصل" وفي manifest التصدير "missing".
 */
export const ARCHIVE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

export async function saveZatcaResponseWithArchive<T>(opts: {
  payload: ZatcaArchivePayload | undefined;
  doc: Parameters<typeof writeZatcaArchiveTx>[1];
  source: "submission" | "resubmission";
  inTx: (tx: Prisma.TransactionClient) => Promise<T>;
  plain: () => Promise<T>;
  /** كل إرسال فعلي لزاتكا (مقبول أو مرفوض) — يُكتَب في zatca_submission_attempts في نفس المعاملة (issues.ts) */
  attempt?: ZatcaAttemptPayload;
  userId?: string | null;
}): Promise<T> {
  if (!opts.payload && !opts.attempt) return opts.plain();
  const payload = opts.payload;
  const attempt = opts.attempt;
  const label = `${opts.doc.documentType} ${opts.doc.documentNumber} (uuid=${opts.doc.documentUuid})`;
  let stage: "begin" | "response" | "archive" | "attempt" | "commit" = "begin";
  try {
    return await prisma.$transaction(async (tx) => {
      stage = "response";
      const saved = await opts.inTx(tx);
      if (payload) {
        stage = "archive";
        await writeZatcaArchiveTx(tx, opts.doc, payload, opts.source);
      }
      if (attempt) {
        stage = "attempt";
        await writeZatcaAttemptTx(tx, opts.doc, attempt, opts.source, opts.userId);
      }
      stage = "commit";
      return saved;
    }, ARCHIVE_TX_OPTIONS);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[zatca-archive] FAILED at ${stage} — ${label}; يُحفَظ ردّ زاتكا وحده ثم محاولة أرشفة مستقلة:`, err);
  }
  // الرد أولاً — لو فشل هنا أيضاً فالخطأ يصعد كما كان قبل الأرشيف (لا يُبتلَع)
  const saved = await opts.plain();
  const standalone = prisma as unknown as Prisma.TransactionClient;
  if (payload) {
    try {
      await writeZatcaArchiveTx(standalone, opts.doc, payload, opts.source);
      // eslint-disable-next-line no-console
      console.error(`[zatca-archive] RECOVERED — أُرشِف ${label} في المحاولة المستقلة بعد فشل المعاملة`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[zatca-archive] FAILED — لم يُحفَظ أصل ${label} نهائياً؛ سيظهر في عدّاد "مقبول بلا أصل" و"missing" في التصدير:`, err);
    }
  }
  if (attempt) {
    try {
      await writeZatcaAttemptTx(standalone, opts.doc, attempt, opts.source, opts.userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[zatca-attempts] FAILED — لم تُسجَّل محاولة إرسال ${label} (النتيجة ${attempt.outcome}):`, err);
    }
  }
  return saved;
}

function unpack(bytes: Uint8Array | null, compression: string): Buffer | null {
  if (!bytes) return null;
  const buf = Buffer.from(bytes);
  return compression === "gzip" ? gunzipSync(buf) : buf;
}

/**
 * اسم الملف بحسب الملحق 1 من قرار الإلزام بالفوترة الإلكترونية: الرقم الضريبي، تاريخ الإصدار، وقت الإصدار، ورقم
 * المستند (IRN) — تُقرأ من المستند نفسه (لا من سجلات قابلة للتعديل). الصيغة:
 *   {VAT}_{YYYYMMDD}T{HHMMSS}_{IRN}.xml — ويُستبدَل بأي محرف خاص في رقم المستند "-".
 */
export function annex1FileName(xml: string, fallback: { sellerVatNumber: string | null; issuedAt: Date; documentNumber: string }) {
  const vat = sellerVatFromXml(xml) ?? fallback.sellerVatNumber ?? "VAT";
  const root = withoutExtensions(xml);
  const date = root.match(/<cbc:IssueDate>([^<]+)<\/cbc:IssueDate>/)?.[1] ?? fallback.issuedAt.toISOString().slice(0, 10);
  const time = root.match(/<cbc:IssueTime>([^<]+)<\/cbc:IssueTime>/)?.[1] ?? fallback.issuedAt.toISOString().slice(11, 19);
  // رقم المستند من الجذر فقط: أول cbc:ID في المستند الموقَّع هو معرّف التوقيع داخل UBLExtensions لا رقم الفاتورة
  const irn = root.match(/<cbc:ID>([^<]+)<\/cbc:ID>/)?.[1] ?? fallback.documentNumber;
  const clean = (s: string) => s.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
  return `${clean(vat)}_${date.replace(/-/g, "")}T${time.replace(/:/g, "").slice(0, 6)}_${clean(irn)}.xml`;
}

// ---------------------------------------------------------------------------
// ZIP بلا مكتبة خارجية: deflate (zlib) + CRC32 + ترويسات ZIP القياسية
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** حدود ZIP الكلاسيكي (بلا ZIP64): 65,535 ملفاً، و4 GiB لأي حجم أو إزاحة. التصدير يرفض قبلها برسالة واضحة. */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;
export class ZipLimitError extends Error {}

/** وقت DOS بتوقيت السعودية (UTC+3، بلا توقيت صيفي) — كما يعرضه مستكشف ويندوز و7-Zip؛ السنة محصورة في 1980–2107 */
function dosDateTime(date: Date) {
  const d = new Date(date.getTime() + 3 * 3_600_000);
  const year = d.getUTCFullYear();
  if (year < 1980) return { dosTime: 0, dosDate: (1 << 5) | 1 };
  if (year > 2107) return { dosTime: (23 << 11) | (59 << 5) | 29, dosDate: (127 << 9) | (12 << 5) | 31 };
  return {
    dosTime: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function buildZip(files: { name: string; data: Buffer; date: Date }[]): Buffer {
  if (files.length > ZIP_MAX_ENTRIES) throw new ZipLimitError(`عدد الملفات ${files.length} يتجاوز حد ZIP (${ZIP_MAX_ENTRIES})`);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const compressed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const { dosTime, dosDate } = dosDateTime(f.date);
    if (f.data.length > ZIP_MAX_BYTES || compressed.length > ZIP_MAX_BYTES || offset > ZIP_MAX_BYTES) {
      throw new ZipLimitError("حجم التصدير يتجاوز حد ZIP (4 GiB)");
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  if (offset > ZIP_MAX_BYTES || centralSize > ZIP_MAX_BYTES) throw new ZipLimitError("حجم التصدير يتجاوز حد ZIP (4 GiB)");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------------------------------------------------------------------
// تصدير الملحق 1 — لشركة وفترة
// ---------------------------------------------------------------------------
export const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // حقن الصيغ: رقم المستند نص حرّ من إعدادات الترقيم — Excel ينفّذ ما يبدأ بـ = + - @ أو محرف تحكّم
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * ملف ZIP بكل مستندات الشركة المُصدَرة في الفترة: لكل مستند محفوظ ملف XML باسم الملحق 1 — المُخلَّص من زاتكا
 * للقياسي (هو المستند القانوني) وإلا الموقَّع الذي أرسلناه — وملف manifest.csv يسرد كل مستند قبلته زاتكا في
 * الفترة، ومنها ما لا أصل له في الأرشيف (أُرسِل قبل بدء الأرشفة)، حتى يكون حجم الفجوة رقماً لا تقديراً.
 */
export async function exportZatcaArchive(tenantId: string, companyId: string, from: Date, toExclusive: Date) {
  const rows = await prisma.zatcaDocumentArchive.findMany({
    where: { tenantId, companyId, issuedAt: { gte: from, lt: toExclusive } },
    orderBy: [{ issuedAt: "asc" }, { archivedAt: "asc" }],
  });
  // حد ZIP الكلاسيكي (بلا ZIP64): رفض واضح قبل تحميل المحتوى، لا خطأ 500 ولا ملف تالف
  const perDocument = new Set(rows.map((r) => `${r.documentType}:${r.documentId}`)).size;
  if (perDocument + 1 > ZIP_MAX_ENTRIES) {
    throw new ZipLimitError(`الفترة تضم ${perDocument} مستنداً — أكثر من حد ملف ZIP الواحد (${ZIP_MAX_ENTRIES - 1}). قسّمها إلى فترات أقصر`);
  }
  // أحدث نسخة لكل مستند (إعادة إرسال بعد فشل تُنتج صفاً جديداً؛ يبقى الأقدم في الأرشيف)
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.documentType}:${r.documentId}`, r);

  const files: { name: string; data: Buffer; date: Date }[] = [];
  const usedNames = new Set<string>();
  const archivedIds = new Set<string>();
  const manifest: string[] = ["documentType,documentNumber,uuid,icv,issuedAt,subtype,status,file,signedXmlSha256,clearedXmlSha256,note"];
  for (const r of latest.values()) {
    const cleared = unpack(r.clearedXml, r.compression);
    const signed = unpack(r.signedXml, r.compression);
    const doc = cleared?.length ? cleared : signed?.length ? signed : null;
    if (!doc) continue; // صف بلا أي محتوى — يُعدّ "missing" أدناه لا "archived"
    archivedIds.add(`${r.documentType}:${r.documentId}`);
    let name = annex1FileName(doc.toString("utf8"), r);
    if (usedNames.has(name)) name = name.replace(/\.xml$/, `_${r.icv}.xml`);
    usedNames.add(name);
    files.push({ name, data: doc, date: r.issuedAt });
    manifest.push([
      r.documentType, r.documentNumber, r.documentUuid, r.icv, r.issuedAt.toISOString(), r.subtype, "archived", name,
      r.signedXmlSha256 ?? "", r.clearedXmlSha256 ?? "",
      r.source === "backfill" ? "المُخلَّص من زاتكا فقط — ملف XML الموقَّع المُرسَل لم يُحفَظ قبل الأرشفة" : "",
    ].map(csvCell).join(","));
  }

  // المستندات المقبولة في الفترة بلا أصل محفوظ — الفجوة التاريخية
  const accepted = { companyId, tenantId, zatcaStatus: { in: ["cleared" as const, "reported" as const] }, zatcaSubmittedAt: { gte: from, lt: toExclusive } };
  const [invoices, returns, debitNotes] = await Promise.all([
    prisma.salesInvoice.findMany({ where: accepted, select: { id: true, invoiceNumber: true, zatcaUuid: true, icv: true, zatcaSubmittedAt: true, zatcaStatus: true } }),
    prisma.salesReturn.findMany({ where: accepted, select: { id: true, returnNumber: true, zatcaUuid: true, icv: true, zatcaSubmittedAt: true, zatcaStatus: true } }),
    prisma.salesDebitNote.findMany({ where: accepted, select: { id: true, debitNoteNumber: true, zatcaUuid: true, icv: true, zatcaSubmittedAt: true, zatcaStatus: true } }),
  ]);
  const missing: { id: string; type: string; number: string; uuid: string; icv: number | null; at: Date | null; status: string }[] = [
    ...invoices.map((d) => ({ type: "sales_invoice", number: d.invoiceNumber, uuid: d.zatcaUuid, icv: d.icv, at: d.zatcaSubmittedAt, status: d.zatcaStatus, id: d.id })),
    ...returns.map((d) => ({ type: "sales_return", number: d.returnNumber, uuid: d.zatcaUuid, icv: d.icv, at: d.zatcaSubmittedAt, status: d.zatcaStatus, id: d.id })),
    ...debitNotes.map((d) => ({ type: "sales_debit_note", number: d.debitNoteNumber, uuid: d.zatcaUuid, icv: d.icv, at: d.zatcaSubmittedAt, status: d.zatcaStatus, id: d.id })),
  ].filter((d) => !archivedIds.has(`${d.type}:${d.id}`));
  for (const d of missing) {
    manifest.push([
      d.type, d.number, d.uuid, d.icv ?? "", d.at?.toISOString() ?? "", d.status === "cleared" ? "standard" : "simplified", "missing", "", "", "",
      d.status === "cleared"
        ? "أُرسِل قبل الأرشفة ولم يبقَ ملف XML المُخلَّص في ردّ زاتكا المحفوظ — لا أصل له"
        : "مبسّطة أُبلِغ عنها قبل الأرشفة — زاتكا لا تُعيد نسخة، والأصل الموقَّع لم يُحفَظ: فجوة دائمة",
    ].map(csvCell).join(","));
  }

  files.push({ name: "manifest.csv", data: Buffer.from("﻿" + manifest.join("\n") + "\n", "utf8"), date: new Date() });
  return {
    zip: buildZip(files),
    archivedCount: archivedIds.size,
    missingCount: missing.length,
  };
}

// ---------------------------------------------------------------------------
// عدّاد الفجوة الجارية — يجب أن يبقى صفراً
// ---------------------------------------------------------------------------
export const ARCHIVE_MIGRATION = "20260928140000_zatca_document_archive";
/** start = prisma migrate deploy && node … — النسخة القديمة تظل تستقبل طلبات حتى تعمل الجديدة؛ ما تقبله زاتكا في
 * تلك الدقائق لا يمرّ بكود الأرشفة أصلاً. مهلة ثابتة بعد تطبيق الترحيل حتى لا يبدأ العدّاد بإنذار كاذب لا يزول. */
export const ARCHIVE_ROLLOUT_GRACE_MS = 15 * 60_000;

export interface UnarchivedSummary {
  /** متى بدأت الأرشفة فعلاً على هذه القاعدة (وقت تطبيق الترحيل)؛ null إن لم يُطبَّق */
  since: Date | null;
  count: number;
  byType: Record<string, number>;
  /** أحدث المستندات الناقصة (حتى 20) للمتابعة */
  latest: { documentType: string; documentNumber: string; companyId: string; acceptedAt: Date }[];
}

/**
 * مستندات قبلتها زاتكا **بعد** بدء الأرشفة ولا أصل لها في الأرشيف. رقم يجب أن يكون صفراً دائماً: غير الصفر يعني أن
 * كتابة الأرشيف تفشل (saveZatcaResponseWithArchive حفظ الرد وحده) — فجوة جديدة تتراكم. ما قبل بدء الأرشفة فجوة تاريخية
 * معروفة (docs/zatca-archive.md) ولا يُحسَب هنا.
 */
export async function unarchivedSinceArchiving(tenantId: string, companyId?: string): Promise<UnarchivedSummary> {
  const live = await prisma.$queryRawUnsafe<{ finished_at: Date | null }[]>(
    `SELECT finished_at FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1`,
    ARCHIVE_MIGRATION,
  );
  const applied = live[0]?.finished_at ?? null;
  if (!applied) return { since: null, count: 0, byType: {}, latest: [] };
  const since = new Date(applied.getTime() + ARCHIVE_ROLLOUT_GRACE_MS);
  const rows = await prisma.$queryRawUnsafe<{ kind: string; number: string; companyId: string; at: Date }[]>(
    `SELECT d.kind, d.number, d."companyId", d.at FROM (
       SELECT 'sales_invoice' AS kind, id, "invoiceNumber" AS number, "tenantId", "companyId", "zatcaClearedOrReportedAt" AS at FROM sales_invoices WHERE "zatcaStatus" IN ('cleared', 'reported')
       UNION ALL
       SELECT 'sales_return', id, "returnNumber", "tenantId", "companyId", "zatcaClearedOrReportedAt" FROM sales_returns WHERE "zatcaStatus" IN ('cleared', 'reported')
       UNION ALL
       SELECT 'sales_debit_note', id, "debitNoteNumber", "tenantId", "companyId", "zatcaClearedOrReportedAt" FROM sales_debit_notes WHERE "zatcaStatus" IN ('cleared', 'reported')
     ) d
     WHERE d."tenantId" = $1 AND ($2::text IS NULL OR d."companyId" = $2) AND d.at >= $3
       AND NOT EXISTS (SELECT 1 FROM zatca_document_archive a WHERE a."documentType" = d.kind AND a."documentId" = d.id)
       -- المستوردة يدوياً من سجلات زاتكا (importClearedSalesInvoice) لم تمرّ بتوقيع ولا إرسال — لا أصل لها أصلاً
       AND NOT EXISTS (SELECT 1 FROM audit_logs l WHERE l.action = 'sales_invoice.imported_from_zatca' AND l."entityId" = d.id)
     ORDER BY d.at DESC`,
    tenantId,
    companyId ?? null,
    since,
  );
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.kind] = (byType[r.kind] || 0) + 1;
  return {
    since,
    count: rows.length,
    byType,
    latest: rows.slice(0, 20).map((r) => ({ documentType: r.kind, documentNumber: r.number, companyId: r.companyId, acceptedAt: r.at })),
  };
}
