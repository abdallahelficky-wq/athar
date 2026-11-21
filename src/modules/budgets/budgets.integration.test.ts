import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createJournalEntry } from "../journalEntries/journalEntries.service";

/**
 * الموازنات عبر HTTP الحقيقي على Postgres، والفعلي من قيود خدمة القيود نفسها:
 * - الموازنة مقابل الفعلي حتى الشهر الثاني: الإيراد دائن−مدين والمصروف مدين−دائن، والقيد المحفوظ لا يُحتسب؛
 * - الانحراف وملاءمته (إيراد أقل من المخطط غير ملائم، مصروف أقل ملائم)؛
 * - الاقتراح من الفعلي مع نمو 10%؛ الموازنة المعتمدة لا تُعدَّل؛ مستأجر آخر لا يرى الموازنة.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailA = `budgets-a-${stamp}@example.com`;
const emailB = `budgets-b-${stamp}@example.com`;
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

describe("budgets (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.budget.deleteMany({ where: { tenantId } });
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  });

  it("compares budget with posted actuals and suggests from actuals", async () => {
    const a = await register({ tenantName: "مستأجر الموازنات", businessActivity: "retail", name: "المالك", email: emailA, password });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر آخر", businessActivity: "retail", name: "آخر", email: emailB, password });
    tenantIds.push(b.tenant.id);
    const token = a.accessToken;
    const userId = (await prisma.user.findFirstOrThrow({ where: { tenantId: a.tenant.id } })).id;
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const cash = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, isBankOrCash: true } });
    const revenue = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, type: "revenue" }, orderBy: { code: "asc" } });
    const expense = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, type: "expense" }, orderBy: { code: "asc" } });
    const entry = (date: string, debit: string, credit: string, amount: number, post = true) =>
      createJournalEntry(a.tenant.id, userId, {
        companyId: company.id, date: new Date(`${date}T00:00:00.000Z`), memo: "اختبار", post,
        lines: [{ accountId: debit, debit: amount, credit: 0 }, { accountId: credit, debit: 0, credit: amount }],
      } as never);
    await entry("2026-01-10", cash.id, revenue.id, 9000);
    await entry("2026-02-10", cash.id, revenue.id, 8000);
    await entry("2026-01-15", expense.id, cash.id, 5000);
    await entry("2026-02-15", expense.id, cash.id, 6500);
    await entry("2026-02-20", cash.id, revenue.id, 777_777, false); // محفوظ — لا يُحتسب

    const created = await call("POST", "/budgets", token, {
      companyId: company.id, name: "موازنة 2026", startMonth: "2026-01",
      lines: [{ accountId: revenue.id, months: Array(12).fill(10_000) }, { accountId: expense.id, months: Array(12).fill(6000) }],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const report = await call("GET", `/budgets/${id}/report?through=2`, token);
    expect(report.status).toBe(200);
    const rev = report.body.lines.find((l: { accountId: string }) => l.accountId === revenue.id);
    const exp = report.body.lines.find((l: { accountId: string }) => l.accountId === expense.id);
    expect(rev.actual.slice(0, 2)).toEqual([9000, 8000]);
    expect(rev.planYtd).toBe(20_000);
    expect(rev.variance).toBe(-3000);
    expect(rev.favorable).toBe(false);
    expect(exp.actualYtd).toBe(11_500);
    expect(exp.variance).toBe(-500);
    expect(exp.favorable).toBe(true);
    expect(report.body.totals.netActualYtd).toBe(5500);
    expect(report.body.months[0]).toBe("2026-01");

    const suggested = await call("GET", `/budgets/suggest?companyId=${company.id}&sourceStartMonth=2026-01&growthPct=10`, token);
    expect(suggested.status).toBe(200);
    expect(suggested.body.find((l: { accountId: string }) => l.accountId === revenue.id).months.slice(0, 2)).toEqual([9900, 8800]);

    expect((await call("POST", `/budgets/${id}/status`, token, { status: "approved" })).status).toBe(200);
    const blocked = await call("PUT", `/budgets/${id}`, token, { companyId: company.id, name: "تعديل", startMonth: "2026-01", lines: [] });
    expect(blocked.status).toBe(400);

    expect((await call("GET", `/budgets/${id}`, b.accessToken)).status).toBe(404);
  });
});
