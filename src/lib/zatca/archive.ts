import { createHash } from "crypto";
import { deflateRawSync, gunzipSync, gzipSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

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

/** الرقم الضريبي للبائع كما في المستند (cac:AccountingSupplierParty ← cac:PartyTaxScheme ← cbc:CompanyID) */
export function sellerVatFromXml(xml: string): string | null {
  const supplier = xml.match(/<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/);
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
  const cleared = payload.clearedInvoiceBase64 ? Buffer.from(payload.clearedInvoiceBase64, "base64") : null;
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
      clearedXml: cleared && cleared.length ? gzipSync(cleared) : null,
      clearedXmlSha256: cleared && cleared.length ? sha256(cleared) : null,
      source,
    },
  });
}

/**
 * يحفظ ردّ زاتكا المقبول وأصل المستند في معاملة واحدة. لو فشلت كتابة الأرشيف (نادراً — خلل في القاعدة نفسها)
 * لا نُسقِط ردّ زاتكا معها: فقدان الرد هو الحادثة الأصلية التي بُني لأجلها الترحيل على ثلاث مراحل (إعادة الإرسال
 * بنفس UUID تُنتج ازدواجاً لدى زاتكا). يُحفَظ الرد وحده ويُسجَّل الفشل بصوت عالٍ، ويظهر المستند في manifest التصدير
 * "missing" — فجوة ظاهرة لا صامتة.
 */
export async function saveZatcaResponseWithArchive<T>(opts: {
  payload: ZatcaArchivePayload | undefined;
  doc: Parameters<typeof writeZatcaArchiveTx>[1];
  source: "submission" | "resubmission";
  inTx: (tx: Prisma.TransactionClient) => Promise<T>;
  plain: () => Promise<T>;
}): Promise<T> {
  if (!opts.payload) return opts.plain();
  const payload = opts.payload;
  try {
    return await prisma.$transaction(async (tx) => {
      const saved = await opts.inTx(tx);
      await writeZatcaArchiveTx(tx, opts.doc, payload, opts.source);
      return saved;
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[zatca-archive] FAILED — لم يُحفَظ أصل المستند المقبول ${opts.doc.documentType} ${opts.doc.documentNumber} (uuid=${opts.doc.documentUuid}); ` +
        `يُحفَظ ردّ زاتكا وحده حتى لا يضيع، وسيظهر المستند "missing" في تصدير الأرشيف:`,
      err,
    );
    return opts.plain();
  }
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
  const date = xml.match(/<cbc:IssueDate>([^<]+)<\/cbc:IssueDate>/)?.[1] ?? fallback.issuedAt.toISOString().slice(0, 10);
  const time = xml.match(/<cbc:IssueTime>([^<]+)<\/cbc:IssueTime>/)?.[1] ?? fallback.issuedAt.toISOString().slice(11, 19);
  const irn = xml.match(/<cbc:ID>([^<]+)<\/cbc:ID>/)?.[1] ?? fallback.documentNumber;
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

export function buildZip(files: { name: string; data: Buffer; date: Date }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const compressed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const d = f.date;
    const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
    const dosDate = ((Math.max(d.getUTCFullYear(), 1980) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();

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
const csv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  // أحدث نسخة لكل مستند (إعادة إرسال بعد فشل تُنتج صفاً جديداً؛ يبقى الأقدم في الأرشيف)
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.documentType}:${r.documentId}`, r);

  const files: { name: string; data: Buffer; date: Date }[] = [];
  const usedNames = new Set<string>();
  const archivedIds = new Set<string>();
  const manifest: string[] = ["documentType,documentNumber,uuid,icv,issuedAt,subtype,status,file,signedXmlSha256,clearedXmlSha256,note"];
  for (const r of latest.values()) {
    archivedIds.add(`${r.documentType}:${r.documentId}`);
    const cleared = unpack(r.clearedXml, r.compression);
    const signed = unpack(r.signedXml, r.compression);
    const doc = cleared ?? signed;
    if (!doc) continue;
    let name = annex1FileName(doc.toString("utf8"), r);
    if (usedNames.has(name)) name = name.replace(/\.xml$/, `_${r.icv}.xml`);
    usedNames.add(name);
    files.push({ name, data: doc, date: r.issuedAt });
    manifest.push([
      r.documentType, r.documentNumber, r.documentUuid, r.icv, r.issuedAt.toISOString(), r.subtype, "archived", name,
      r.signedXmlSha256 ?? "", r.clearedXmlSha256 ?? "",
      r.source === "backfill" ? "المُخلَّص من زاتكا فقط — ملف XML الموقَّع المُرسَل لم يُحفَظ قبل الأرشفة" : "",
    ].map(csv).join(","));
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
    ].map(csv).join(","));
  }

  files.push({ name: "manifest.csv", data: Buffer.from("﻿" + manifest.join("\n") + "\n", "utf8"), date: new Date() });
  return {
    zip: buildZip(files),
    archivedCount: latest.size,
    missingCount: missing.length,
  };
}
