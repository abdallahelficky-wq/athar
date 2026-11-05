import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { defaultVatRateForCountry } from "./countries";

/**
 * نسبة ضريبة القيمة المضافة التي تُحسَب بها مستندات شركة (بالمئة). مصدرها Company.vatRate، وتُقترَح من الدولة عند الإنشاء
 * (src/lib/countries.ts). الشركة السعودية تبقى 15% دائماً: مسار زاتكا (XML/QR/التوقيع) مبني على هذه النسبة، وتعديلها من
 * الواجهة مقفل. نفس القاعدة في الواجهة: frontend/src/wired/shared/invoiceLine.js (vatRatePercentOf).
 */
export const SAUDI_VAT_RATE_PERCENT = 15;

type CompanyVatLike = { country?: string | null; vatRate?: Prisma.Decimal | number | string | null } | null | undefined;

export function vatRatePercentOf(company: CompanyVatLike): number {
  if (!company || (company.country || "SA") === "SA") return SAUDI_VAT_RATE_PERCENT;
  const rate = Number(company.vatRate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : SAUDI_VAT_RATE_PERCENT;
}

/** النسبة التي تُحفَظ للشركة: السعودية 15 دائماً؛ غيرها ما طُلب أو المقترح لدولتها. */
export function resolveCompanyVatRate(country: string | null | undefined, requested: number | null | undefined): number {
  const code = country || "SA";
  if (code === "SA") return SAUDI_VAT_RATE_PERCENT;
  return requested ?? defaultVatRateForCountry(code);
}

export async function companyVatRatePercent(tenantId: string, companyId: string, db: Prisma.TransactionClient | PrismaClient = prisma): Promise<number> {
  const company = await db.company.findFirst({ where: { id: companyId, tenantId }, select: { country: true, vatRate: true } });
  return vatRatePercentOf(company);
}

