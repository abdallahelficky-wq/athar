import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { env } from "../../config/env";
import { register } from "../auth/auth.service";
import { createJournalEntry } from "../journalEntries/journalEntries.service";

/**
 * التسوية البنكية عبر HTTP الحقيقي على Postgres، بقيود مرحَّلة أنشأتها خدمة القيود نفسها:
 * - رفع كشف ⇒ مطابقة تلقائية بالمبلغ الموقَّع والتاريخ؛ إيداع في الطريق (في الدفاتر لا البنك) وعمولة (في البنك لا الدفاتر)
 *   يظهران في الملخص والفرق صفر؛ التسوية مرفوضة ما دام سطر الكشف غير مطابَق؛
 * - قيد العمولة + مطابقة يدوية ⇒ تسوية؛ فك ترحيل قيد مطابَق في كشف مُسوّى مرفوض؛ بعد إعادة الفتح يُفك الترحيل
 *   وتُفك المطابقة تلقائياً؛
 * - كشف غير متّسق (افتتاحي + حركات ≠ ختامي) مرفوض؛ مطابقة بمبلغ مختلف مرفوضة؛ مستأجر آخر لا يرى الكشف.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailA = `bank-rec-a-${stamp}@example.com`;
const emailB = `bank-rec-b-${stamp}@example.com`;
const password = "Str0ng-Pass!";
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("bank reconciliation (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.bankStatement.deleteMany({ where: { tenantId } });
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  });

  it("matches, explains the difference, reconciles, and protects reconciled entries", async () => {
    const a = await register({ tenantName: "مستأجر تسوية بنكية", businessActivity: "retail", name: "المالك", email: emailA, password });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر آخر", businessActivity: "retail", name: "آخر", email: emailB, password });
    tenantIds.push(b.tenant.id);
    const token = a.accessToken;
    const userId = (await prisma.user.findFirstOrThrow({ where: { tenantId: a.tenant.id } })).id;
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const bank = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, isBankOrCash: true, isPosting: true } });
    const other = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, isBankOrCash: false, type: "revenue" } });

    const entry = (date: string, amount: number, memo: string) =>
      createJournalEntry(a.tenant.id, userId, {
        companyId: company.id,
        date: new Date(`${date}T00:00:00.000Z`),
        memo,
        post: true,
        lines:
          amount > 0
            ? [{ accountId: bank.id, debit: amount, credit: 0 }, { accountId: other.id, debit: 0, credit: amount }]
            : [{ accountId: other.id, debit: -amount, credit: 0 }, { accountId: bank.id, debit: 0, credit: -amount }],
      } as never);
    await entry("2026-03-05", 1000, "إيداع");
    const withdrawal = await entry("2026-03-10", -250, "سحب");
    await entry("2026-03-28", 500, "إيداع في الطريق");

    const base = { companyId: company.id, accountId: bank.id, periodStart: "2026-03-01", periodEnd: "2026-03-31", openingBalance: 0, fileName: "march.xlsx" };
    const lines = [
      { date: "2026-03-06", description: "Deposit", amount: 1000 },
      { date: "2026-03-10", description: "Transfer", reference: "TRX-1", amount: -250 },
      { date: "2026-03-31", description: "Bank fee", amount: -15 },
    ];

    const inconsistent = await call("POST", "/bank-reconciliation/statements", token, { ...base, closingBalance: 900, lines });
    expect(inconsistent.status).toBe(400);

    const created = await call("POST", "/bank-reconciliation/statements", token, { ...base, closingBalance: 735, lines });
    expect(created.status).toBe(201);
    const st = created.body;
    const byDesc = (d: string) => st.lines.find((l: { description: string }) => l.description === d);
    expect(byDesc("Deposit").matchType).toBe("auto");
    expect(byDesc("Transfer").matchType).toBe("auto");
    expect(byDesc("Bank fee").journalEntryLineId).toBeNull();
    expect(st.summary.bookBalance).toBe(1250);
    expect(st.summary.unmatchedBookTotal).toBe(500);
    expect(st.summary.unmatchedBankTotal).toBe(-15);
    expect(st.summary.difference).toBe(0);
    expect(st.summary.canReconcile).toBe(false);
    expect((await call("POST", `/bank-reconciliation/statements/${st.id}/reconcile`, token)).status).toBe(400);

    // سطر قيد بمبلغ مختلف لا يُطابَق
    const inTransit = st.outstandingBookLines[0];
    const wrong = await call("POST", `/bank-reconciliation/statements/${st.id}/lines/${byDesc("Bank fee").id}/match`, token, { journalEntryLineId: inTransit.id });
    expect(wrong.status).toBe(400);

    // قيد العمولة ثم مطابقة يدوية ثم تسوية
    const fee = await entry("2026-03-31", -15, "عمولة بنكية");
    const feeBankLine = fee.lines.find((l: { accountId: string }) => l.accountId === bank.id)!;
    const matched = await call("POST", `/bank-reconciliation/statements/${st.id}/lines/${byDesc("Bank fee").id}/match`, token, { journalEntryLineId: feeBankLine.id });
    expect(matched.status).toBe(200);
    expect(matched.body.summary.canReconcile).toBe(true);
    const reconciled = await call("POST", `/bank-reconciliation/statements/${st.id}/reconcile`, token);
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.status).toBe("reconciled");

    // قيد مطابَق في كشف مُسوّى لا يُفك ترحيله
    const blocked = await call("POST", `/journal-entries/${withdrawal.id}/unpost`, token, { pin: env.defaultUnlockPin });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/تسوية بنكية مُسوّاة/);

    // بعد إعادة الفتح: يُفك الترحيل وتُفك المطابقة تلقائياً
    expect((await call("POST", `/bank-reconciliation/statements/${st.id}/reopen`, token)).status).toBe(200);
    const unposted = await call("POST", `/journal-entries/${withdrawal.id}/unpost`, token, { pin: env.defaultUnlockPin });
    expect(unposted.status).toBe(200);
    const after = await call("GET", `/bank-reconciliation/statements/${st.id}`, token);
    expect(after.body.lines.find((l: { description: string }) => l.description === "Transfer").journalEntryLineId).toBeNull();

    // عزل المستأجر
    expect((await call("GET", `/bank-reconciliation/statements/${st.id}`, b.accessToken)).status).toBe(404);
    const listB = await call("GET", `/bank-reconciliation/statements?companyId=${company.id}`, b.accessToken);
    expect(listB.status === 403 || (listB.status === 200 && listB.body.length === 0)).toBe(true);
  });
});
