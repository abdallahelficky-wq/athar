import { Prisma, SourceModule } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { round2, type VatPeriod } from "../../lib/vatPeriod";
import { INPUT_VAT_ACCOUNT_NAME, OUTPUT_VAT_ACCOUNT_NAME, resolveVatAccount, type ResolvedVatAccount } from "../../lib/vatAccounts";

/**
 * مطابقة الضريبة لشركة واحدة عن فترة إقرار: ضريبة المستندات المرحَّلة المؤرَّخة في الفترة مقابل
 * حركة حساب الضريبة (القيود المرحَّلة المؤرَّخة في الفترة)، والفرق مفصَّلاً بنوده قيداً قيداً
 * ومستنداً مستنداً:
 *   - قيود يدوية/مستوردة/أي مصدر غير المستندات تمسّ حساب الضريبة؛
 *   - ضريبة ورديات المحطات (مخرجات بلا مستند ضريبي)؛
 *   - مستند في الفترة وقيده خارجها (أو بلا قيد، أو قيده لا يمسّ هذا الحساب) — والعكس؛
 *   - مستند قيده يمسّ الحساب بمبلغ يختلف عن ضريبة المستند.
 * الباقي بعد البنود يجب أن يكون صفراً؛ أي باقٍ يُعرَض صراحةً كتحذير.
 *
 * وخارج المعادلة (غائبة عن الطرفين معاً، فلا تظهر في الفرق أصلاً لكنها تمسّ الإقرار):
 *   - مستندات مؤرَّخة في الفترة أُلغي ترحيلها لاحقاً (من سجل التدقيق *.unpost)؛
 *   - مستندات صدرت لزاتكا أو تنتظرها ولم تكتمل كتابتها المحاسبية؛
 *   - قيود محفوظة غير مرحَّلة تمسّ الحساب (يحسبها ميزان المراجعة الحالي رغم أنها غير مرحَّلة)؛
 *   - حسابات أخرى باسم «ضريبة القيمة المضافة» عليها حركة في الفترة غير الحساب الذي يُرحَّل إليه.
 *
 * الحساب هو نفسه الذي يُرحَّل إليه (resolveVatAccount بنفس الاسم الذي تمرّره مسارات الترحيل).
 */

type Side = "output" | "input";

interface DocKind {
  entityType: "SalesInvoice" | "SalesDebitNote" | "SalesReturn" | "PurchaseInvoice" | "PurchaseReturn";
  sourceModule: SourceModule;
  sign: 1 | -1;
}

const KINDS: Record<Side, DocKind[]> = {
  output: [
    { entityType: "SalesInvoice", sourceModule: "sales_invoice", sign: 1 },
    { entityType: "SalesDebitNote", sourceModule: "sales_debit_note", sign: 1 },
    { entityType: "SalesReturn", sourceModule: "sales_return", sign: -1 },
  ],
  input: [
    { entityType: "PurchaseInvoice", sourceModule: "purchase_invoice", sign: 1 },
    { entityType: "PurchaseReturn", sourceModule: "purchase_return", sign: -1 },
  ],
};

const DOCUMENT_MODULES = new Set<SourceModule>(Object.values(KINDS).flat().map((k) => k.sourceModule));

interface Doc {
  entityType: DocKind["entityType"];
  id: string;
  number: string;
  date: Date;
  status: string;
  vat: number; // بإشارته في الإقرار: موجبة للفواتير والإشعارات المدينة، سالبة للمردودات
  journalEntryId: string | null;
  zatcaStatus?: string | null;
}

interface DocFilter {
  tenantId: string;
  companyId: string;
  status?: Prisma.EnumInvoiceStatusFilter | "posted" | "draft";
  date?: { gte: Date; lt: Date };
  journalEntryId?: { in: string[] };
  id?: { in: string[] };
}

async function findDocs(kind: DocKind, where: DocFilter): Promise<Doc[]> {
  const base = { id: true, date: true, status: true, vatTotal: true, journalEntryId: true } as const;
  const w = where as never;
  const map = (rows: { id: string; date: Date; status: string; vatTotal: Prisma.Decimal; journalEntryId: string | null; zatcaStatus?: string }[], numberOf: (r: never) => string) =>
    rows.map((r) => ({
      entityType: kind.entityType, id: r.id, number: numberOf(r as never), date: r.date, status: r.status,
      vat: kind.sign * Number(r.vatTotal), journalEntryId: r.journalEntryId, zatcaStatus: r.zatcaStatus ?? null,
    }));
  switch (kind.entityType) {
    case "SalesInvoice":
      return map(await prisma.salesInvoice.findMany({ where: w, select: { ...base, invoiceNumber: true, zatcaStatus: true } }), (r: { invoiceNumber: string }) => r.invoiceNumber);
    case "SalesDebitNote":
      return map(await prisma.salesDebitNote.findMany({ where: w, select: { ...base, debitNoteNumber: true, zatcaStatus: true } }), (r: { debitNoteNumber: string }) => r.debitNoteNumber);
    case "SalesReturn":
      return map(await prisma.salesReturn.findMany({ where: w, select: { ...base, returnNumber: true, zatcaStatus: true } }), (r: { returnNumber: string }) => r.returnNumber);
    case "PurchaseInvoice":
      return map(await prisma.purchaseInvoice.findMany({ where: w, select: { ...base, invoiceNumber: true } }), (r: { invoiceNumber: string }) => r.invoiceNumber);
    case "PurchaseReturn":
      return map(await prisma.purchaseReturn.findMany({ where: w, select: { ...base, returnNumber: true } }), (r: { returnNumber: string }) => r.returnNumber);
  }
}

interface EntryRow {
  journalEntryId: string;
  entryNumber: string;
  date: string;
  memo: string | null;
  sourceModule: SourceModule;
  amount: number;
  document?: { entityType: string; id: string; number: string; date: string } | null;
}

interface DocRow {
  entityType: string;
  id: string;
  number: string;
  date: string;
  documentVat: number;
  amount: number; // أثره على الفرق (حركة الحساب − ضريبة المستندات)
  journalEntryId: string | null;
  entryNumber?: string | null;
  entryDate?: string | null;
  reason?: "no_entry" | "entry_outside_period" | "entry_without_vat_line";
}

const day = (d: Date) => d.toISOString();
const inPeriod = (d: Date, p: VatPeriod) => d >= p.start && d < p.endExclusive;

async function reconcileSide(tenantId: string, period: VatPeriod, side: Side, account: ResolvedVatAccount | null) {
  const kinds = KINDS[side];
  const dateRange = { gte: period.start, lt: period.endExclusive };
  const base = { tenantId, companyId: period.companyId };

  const docs = (await Promise.all(kinds.map((k) => findDocs(k, { ...base, status: "posted", date: dateRange })))).flat();
  const documentVat = round2(docs.reduce((s, d) => s + d.vat, 0));
  const documentVatByType = Object.fromEntries(
    kinds.map((k) => [k.entityType, round2(docs.filter((d) => d.entityType === k.entityType).reduce((s, d) => s + d.vat, 0))]),
  );

  const signed = (debit: Prisma.Decimal | number, credit: Prisma.Decimal | number) =>
    side === "output" ? Number(credit) - Number(debit) : Number(debit) - Number(credit);

  // حركة الحساب: استعلام تجميعي مستقل عن استعلام التفصيل أدناه، فالباقي فحصٌ فعلي لا تحصيل حاصل.
  let ledgerMovement = 0;
  const entries = new Map<string, EntryRow>();
  if (account) {
    const agg = await prisma.journalEntryLine.aggregate({
      where: { accountId: account.id, journalEntry: { ...base, status: "posted", date: dateRange } },
      _sum: { debit: true, credit: true },
    });
    ledgerMovement = round2(signed(agg._sum.debit ?? 0, agg._sum.credit ?? 0));

    const lines = await prisma.journalEntryLine.findMany({
      where: { accountId: account.id, journalEntry: { ...base, status: "posted", date: dateRange } },
      select: {
        debit: true, credit: true,
        journalEntry: { select: { id: true, entryNumber: true, date: true, memo: true, sourceModule: true } },
      },
    });
    for (const l of lines) {
      const je = l.journalEntry;
      const row = entries.get(je.id) ?? {
        journalEntryId: je.id, entryNumber: je.entryNumber, date: day(je.date), memo: je.memo, sourceModule: je.sourceModule, amount: 0,
      };
      row.amount += signed(l.debit, l.credit);
      entries.set(je.id, row);
    }
  }

  const docByEntry = new Map(docs.filter((d) => d.journalEntryId).map((d) => [d.journalEntryId!, d]));

  const amountMismatch: DocRow[] = [];
  const documentEntryOutsidePeriod: DocRow[] = [];
  const entryForDocumentOutsidePeriod: EntryRow[] = [];
  const stationShifts: EntryRow[] = [];
  const otherSources: EntryRow[] = [];

  // مستندات الفترة: قيدها في الفترة بنفس المبلغ (مطابق)، أو بمبلغ مختلف، أو خارج الفترة/بلا قيد/لا يمسّ الحساب
  const docEntryIds = docs.map((d) => d.journalEntryId).filter((id): id is string => !!id && !entries.has(id));
  const outsideEntries = new Map(
    (await prisma.journalEntry.findMany({ where: { tenantId, id: { in: docEntryIds } }, select: { id: true, entryNumber: true, date: true } }))
      .map((e) => [e.id, e]),
  );
  for (const d of docs) {
    const row: DocRow = {
      entityType: d.entityType, id: d.id, number: d.number, date: day(d.date), documentVat: round2(d.vat), amount: 0, journalEntryId: d.journalEntryId,
    };
    const inside = d.journalEntryId ? entries.get(d.journalEntryId) : undefined;
    if (inside) {
      const diff = round2(inside.amount - d.vat);
      if (diff !== 0) amountMismatch.push({ ...row, amount: diff, entryNumber: inside.entryNumber, entryDate: inside.date });
      continue;
    }
    if (round2(d.vat) === 0) continue;
    const outside = d.journalEntryId ? outsideEntries.get(d.journalEntryId) : undefined;
    const reason = !outside ? "no_entry" : inPeriod(outside.date, period) ? "entry_without_vat_line" : "entry_outside_period";
    documentEntryOutsidePeriod.push({
      ...row, amount: round2(-d.vat), entryNumber: outside?.entryNumber ?? null, entryDate: outside ? day(outside.date) : null, reason,
    });
  }

  // قيود الفترة غير المرتبطة بمستند من مستندات الفترة
  const orphanDocEntryIds = [...entries.values()].filter((e) => !docByEntry.has(e.journalEntryId) && DOCUMENT_MODULES.has(e.sourceModule)).map((e) => e.journalEntryId);
  const docsForOrphans = new Map<string, Doc>();
  if (orphanDocEntryIds.length) {
    for (const k of kinds) {
      for (const d of await findDocs(k, { ...base, journalEntryId: { in: orphanDocEntryIds } })) docsForOrphans.set(d.journalEntryId!, d);
    }
  }
  for (const e of entries.values()) {
    if (docByEntry.has(e.journalEntryId)) continue;
    const row = { ...e, amount: round2(e.amount) };
    if (row.amount === 0) continue;
    if (DOCUMENT_MODULES.has(e.sourceModule)) {
      const d = docsForOrphans.get(e.journalEntryId);
      entryForDocumentOutsidePeriod.push({ ...row, document: d ? { entityType: d.entityType, id: d.id, number: d.number, date: day(d.date) } : null });
    } else if (e.sourceModule === "station_shift") {
      stationShifts.push(row);
    } else {
      otherSources.push(row);
    }
  }

  const total = (rows: { amount: number }[]) => round2(rows.reduce((s, r) => s + r.amount, 0));
  const items = {
    otherSources: { total: total(otherSources), rows: otherSources.sort((a, b) => a.date.localeCompare(b.date)) },
    stationShifts: { total: total(stationShifts), rows: stationShifts.sort((a, b) => a.date.localeCompare(b.date)) },
    documentEntryOutsidePeriod: { total: total(documentEntryOutsidePeriod), rows: documentEntryOutsidePeriod },
    entryForDocumentOutsidePeriod: { total: total(entryForDocumentOutsidePeriod), rows: entryForDocumentOutsidePeriod },
    amountMismatch: { total: total(amountMismatch), rows: amountMismatch },
  };
  const difference = round2(ledgerMovement - documentVat);
  const itemised = round2(Object.values(items).reduce((s, i) => s + i.total, 0));
  const residual = round2(difference - itemised);

  // ---- خارج المعادلة ----
  // مستندات رُحِّلت بتاريخ داخل الفترة ثم أُلغي ترحيلها: من صفوف التدقيق نفسها (لقطة المستند وقت
  // فك الترحيل)، لا من المسودات الحالية — فتبقى ظاهرة ولو عُدِّل المستند أو حُذف بعد ذلك. الصفوف
  // الأقدم بلا لقطة تُكمَّل من المستند الحالي إن بقي (ويضيع ما حُذف منها، إذ لا شيء يحدّد فترته).
  const unpostRows = await prisma.auditLog.findMany({
    where: {
      tenantId, entityType: { in: kinds.map((k) => k.entityType) }, action: { endsWith: ".unpost" },
      OR: [{ companyId: period.companyId }, { companyId: null }],
    },
    orderBy: { createdAt: "asc" },
    select: { entityType: true, entityId: true, companyId: true, createdAt: true, actorName: true, actorEmail: true, metadata: true },
  });
  type Snapshot = { number: string; date: string; vatTotal: number };
  const snapshotOf = (m: Prisma.JsonValue): Snapshot | null => {
    const snap = m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>).vatSnapshot : null;
    return snap && typeof snap === "object" ? (snap as Snapshot) : null;
  };
  const touchedIds = [...new Set(unpostRows.map((r) => r.entityId))];
  const currentDocs = new Map<string, Doc>();
  if (touchedIds.length) {
    for (const k of kinds) for (const d of await findDocs(k, { ...base, id: { in: touchedIds } })) currentDocs.set(d.id, d);
  }
  const kindOf = new Map(kinds.map((k) => [k.entityType as string, k]));
  const lastUnpostInPeriod = new Map<string, { row: (typeof unpostRows)[number]; number: string; date: Date; vat: number; fromSnapshot: boolean }>();
  for (const r of unpostRows) {
    const snap = snapshotOf(r.metadata);
    const kind = kindOf.get(r.entityType)!;
    let candidate: { number: string; date: Date; vat: number; fromSnapshot: boolean } | null = null;
    if (snap && r.companyId === period.companyId) {
      candidate = { number: snap.number, date: new Date(snap.date), vat: kind.sign * Number(snap.vatTotal), fromSnapshot: true };
    } else if (!snap) {
      const d = currentDocs.get(r.entityId);
      if (d) candidate = { number: d.number, date: d.date, vat: d.vat, fromSnapshot: false };
    }
    if (candidate && inPeriod(candidate.date, period)) lastUnpostInPeriod.set(r.entityId, { row: r, ...candidate });
  }
  const unpostedDocuments = [...lastUnpostInPeriod.entries()]
    .filter(([id]) => {
      const now = currentDocs.get(id);
      return !(now && now.status === "posted" && inPeriod(now.date, period)); // أُعيد ترحيله داخل الفترة: عاد للطرفين
    })
    .map(([id, u]) => {
      const now = currentDocs.get(id);
      return {
        entityType: u.row.entityType, id, number: u.number, date: day(u.date), documentVat: round2(u.vat),
        unpostedAt: day(u.row.createdAt), unpostedBy: u.row.actorName ?? u.row.actorEmail ?? null, fromSnapshot: u.fromSnapshot,
        current: now ? { status: now.status, date: day(now.date), documentVat: round2(now.vat), zatcaStatus: now.zatcaStatus ?? null } : null,
      };
    });

  const notFullyPosted = side === "output"
    ? (await Promise.all(kinds.map((k) => findDocs(k, { ...base, status: { in: ["pending_submission", "zatca_accepted_posting_incomplete"] }, date: dateRange }))))
        .flat()
        .map((d) => ({ entityType: d.entityType, id: d.id, number: d.number, date: day(d.date), documentVat: round2(d.vat), status: d.status, zatcaStatus: d.zatcaStatus ?? null }))
    : [];

  const savedEntries: EntryRow[] = [];
  if (account) {
    const lines = await prisma.journalEntryLine.findMany({
      where: { accountId: account.id, journalEntry: { ...base, status: "saved", date: dateRange } },
      select: { debit: true, credit: true, journalEntry: { select: { id: true, entryNumber: true, date: true, memo: true, sourceModule: true } } },
    });
    const byEntry = new Map<string, EntryRow>();
    for (const l of lines) {
      const je = l.journalEntry;
      const row = byEntry.get(je.id) ?? { journalEntryId: je.id, entryNumber: je.entryNumber, date: day(je.date), memo: je.memo, sourceModule: je.sourceModule, amount: 0 };
      row.amount += signed(l.debit, l.credit);
      byEntry.set(je.id, row);
    }
    for (const r of byEntry.values()) savedEntries.push({ ...r, amount: round2(r.amount) });
  }

  return {
    account,
    documentVat,
    documentVatByType,
    documentCount: docs.length,
    ledgerMovement,
    difference,
    items,
    residual,
    outsideBothSides: {
      unpostedDocuments,
      notFullyPosted,
      savedEntries,
    },
  };
}

/** حسابات أخرى في شجرة الشركة يحمل اسمها «ضريبة القيمة المضافة» وعليها حركة مرحَّلة في الفترة. */
async function otherVatNamedAccounts(tenantId: string, period: VatPeriod, excludeIds: string[]) {
  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId: period.companyId, name: { contains: "ضريبة القيمة المضافة" }, id: { notIn: excludeIds } },
    select: { id: true, code: true, name: true, isPosting: true, isArchived: true, isActive: true },
    orderBy: { code: "asc" },
  });
  const rows = [];
  for (const a of accounts) {
    const agg = await prisma.journalEntryLine.aggregate({
      where: { accountId: a.id, journalEntry: { tenantId, companyId: period.companyId, status: "posted", date: { gte: period.start, lt: period.endExclusive } } },
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });
    if (agg._count._all === 0) continue;
    rows.push({ ...a, debit: round2(Number(agg._sum.debit ?? 0)), credit: round2(Number(agg._sum.credit ?? 0)), lineCount: agg._count._all });
  }
  return rows;
}

export async function getVatReconciliation(tenantId: string, period: VatPeriod) {
  const [outputAccount, inputAccount] = await Promise.all([
    resolveVatAccount(tenantId, period.companyId, OUTPUT_VAT_ACCOUNT_NAME),
    resolveVatAccount(tenantId, period.companyId, INPUT_VAT_ACCOUNT_NAME),
  ]);
  const [output, input, otherAccounts] = await Promise.all([
    reconcileSide(tenantId, period, "output", outputAccount),
    reconcileSide(tenantId, period, "input", inputAccount),
    otherVatNamedAccounts(tenantId, period, [outputAccount?.id, inputAccount?.id].filter((id): id is string => !!id)),
  ]);
  return {
    period: { companyId: period.companyId, from: period.from, to: period.to },
    output,
    input,
    otherVatNamedAccounts: otherAccounts,
    netVatPerDocuments: round2(output.documentVat - input.documentVat),
    netVatPerLedger: round2(output.ledgerMovement - input.ledgerMovement),
  };
}
