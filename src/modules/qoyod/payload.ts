import { Prisma } from "@prisma/client";

export type Mapping = { accounts: Record<string, number>; contacts: Record<string, number> };
type Line = { accountId: string; debit: { toString(): string }; credit: { toString(): string }; description: string | null; customerId?: string | null; supplierId?: string | null };
export function journalPayload(entry: { id: string; companyId: string; entryNumber: string; date: Date; memo: string | null; lines: Line[] }, mapping: Mapping) {
  const debit_amounts: object[] = [], credit_amounts: object[] = [];
  let debit = new Prisma.Decimal(0), credit = new Prisma.Decimal(0);
  for (const line of entry.lines) {
    const account_id = mapping.accounts[line.accountId];
    if (!Number.isSafeInteger(account_id) || account_id <= 0) throw new Error("يلزم ربط جميع حسابات القيد بحسابات قيود");
    const party = line.customerId ? `customer:${line.customerId}` : line.supplierId ? `supplier:${line.supplierId}` : null;
    const contact_id = party ? mapping.contacts[party] : undefined;
    if (party && (!Number.isSafeInteger(contact_id) || !contact_id || contact_id <= 0)) throw new Error("يلزم ربط طرف القيد بالعميل أو المورد الموجود في قيود");
    const d = new Prisma.Decimal(line.debit.toString()), c = new Prisma.Decimal(line.credit.toString());
    if (d.isNegative() || c.isNegative() || (d.gt(0) && c.gt(0))) throw new Error("سطر قيد غير صالح للإرسال");
    const base = { account_id, ...(contact_id ? { contact_id } : {}), comment: line.description || "" };
    if (d.gt(0)) debit_amounts.push({ ...base, amount: d.toFixed(2) });
    if (c.gt(0)) credit_amounts.push({ ...base, amount: c.toFixed(2) });
    debit = debit.plus(d); credit = credit.plus(c);
  }
  if (!debit.gt(0) || !debit.equals(credit)) throw new Error("القيد غير متوازن");
  return { journal_entry: { description: `[ATHAR:${entry.companyId}:${entry.id}] ${entry.entryNumber} ${entry.memo || ""}`, date: entry.date.toISOString().slice(0, 10), debit_amounts, credit_amounts } };
}
