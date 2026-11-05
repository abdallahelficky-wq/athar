import type { TaxCategoryCode } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { round2, type VatPeriod } from "../../lib/vatPeriod";
import { OUTPUT_VAT_ACCOUNT_NAME, resolveVatAccount, stationShiftOutputVat } from "../../lib/vatAccounts";

/**
 * مسودة إقرار ضريبة القيمة المضافة حسب فئة الضريبة على السطر (S أساسية، Z صفرية، E معفاة، O خارج النطاق) —
 * من نفس المستندات المرحَّلة المؤرَّخة في الفترة التي يعدّها ملخص المبيعات/المشتريات ومطابقة الضريبة:
 *   المبيعات = سطور الفواتير + سطور الإشعارات المدينة، والتعديلات = سطور المردودات (بفئتها).
 *   المشتريات = سطور فواتير المشتريات، والتعديلات = سطور مردوداتها (بلا فئة في النظام: بضريبة → أساسية، بدونها → صفرية).
 * ضريبة ورديات المحطات سطر مستقل تحت المبيعات الأساسية (تُرحَّل بلا مستند ضريبي — كملخص ضريبة المبيعات).
 * الصادرات والاستيراد بالاحتساب العكسي لا تُميَّز في النظام: كل صفري في خانة واحدة، ويُذكر ذلك في الواجهة.
 * هذه مسودة للمراجعة قبل التقديم — المرجع النهائي هو منصة الهيئة.
 */
type Bucket = { base: number; vat: number; adjustmentBase: number; adjustmentVat: number };
const CATEGORIES: TaxCategoryCode[] = ["S", "Z", "E", "O"];
const empty = (): Record<TaxCategoryCode, Bucket> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, { base: 0, vat: 0, adjustmentBase: 0, adjustmentVat: 0 }])) as Record<TaxCategoryCode, Bucket>;

export async function getVatReturn(tenantId: string, period: VatPeriod) {
  const doc = { tenantId, companyId: period.companyId, status: "posted" as const, date: { gte: period.start, lt: period.endExclusive } };
  const sel = { taxCategoryCode: true, subtotal: true, vat: true } as const;
  const [salesLines, debitLines, returnLines, purchaseLines, purchaseReturnLines, outputAccount] = await Promise.all([
    prisma.salesInvoiceLine.findMany({ where: { invoice: doc }, select: sel }),
    prisma.salesDebitNoteLine.findMany({ where: { salesDebitNote: doc }, select: sel }),
    prisma.salesReturnLine.findMany({ where: { salesReturn: doc }, select: sel }),
    prisma.purchaseInvoiceLine.findMany({ where: { invoice: doc }, select: sel }),
    prisma.purchaseReturnLine.findMany({ where: { purchaseReturn: doc }, select: { subtotal: true, vat: true } }),
    resolveVatAccount(tenantId, period.companyId, OUTPUT_VAT_ACCOUNT_NAME),
  ]);
  const station = await stationShiftOutputVat(tenantId, period, outputAccount?.id ?? null);

  const sales = empty();
  const purchases = empty();
  for (const l of [...salesLines, ...debitLines]) {
    sales[l.taxCategoryCode].base += Number(l.subtotal);
    sales[l.taxCategoryCode].vat += Number(l.vat);
  }
  for (const l of returnLines) {
    sales[l.taxCategoryCode].adjustmentBase -= Number(l.subtotal);
    sales[l.taxCategoryCode].adjustmentVat -= Number(l.vat);
  }
  for (const l of purchaseLines) {
    purchases[l.taxCategoryCode].base += Number(l.subtotal);
    purchases[l.taxCategoryCode].vat += Number(l.vat);
  }
  for (const l of purchaseReturnLines) {
    const c: TaxCategoryCode = Number(l.vat) > 0 ? "S" : "Z";
    purchases[c].adjustmentBase -= Number(l.subtotal);
    purchases[c].adjustmentVat -= Number(l.vat);
  }
  const finalize = (b: Record<TaxCategoryCode, Bucket>) =>
    Object.fromEntries(
      CATEGORIES.map((c) => [c, { base: round2(b[c].base), vat: round2(b[c].vat), adjustmentBase: round2(b[c].adjustmentBase), adjustmentVat: round2(b[c].adjustmentVat), netBase: round2(b[c].base + b[c].adjustmentBase), netVat: round2(b[c].vat + b[c].adjustmentVat) }]),
    ) as Record<TaxCategoryCode, Bucket & { netBase: number; netVat: number }>;
  const s = finalize(sales);
  const p = finalize(purchases);
  const totalOutputVat = round2(CATEGORIES.reduce((sum, c) => sum + s[c].netVat, 0) + station.vat);
  const totalInputVat = round2(CATEGORIES.reduce((sum, c) => sum + p[c].netVat, 0));
  return {
    period: { companyId: period.companyId, from: period.from, to: period.to },
    sales: s,
    purchases: p,
    stationShiftVat: round2(station.vat),
    stationShiftCount: station.shiftCount,
    totalSalesBase: round2(CATEGORIES.reduce((sum, c) => sum + s[c].netBase, 0)),
    totalPurchasesBase: round2(CATEGORIES.reduce((sum, c) => sum + p[c].netBase, 0)),
    totalOutputVat,
    totalInputVat,
    netVat: round2(totalOutputVat - totalInputVat),
  };
}
