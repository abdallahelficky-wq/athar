import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createJournalEntry } from "../journalEntries/journalEntries.service";

/**
 * الزكاة عبر HTTP الحقيقي على Postgres، بقيود من خدمة القيود نفسها:
 * - رأس مال 100,000 + ربح السنة 30,000 (حقوق ملكية آخر المدة 130,000)، أصل ثابت 60,000 محسوم، تسوية +5,000
 *   ⇒ الوعاء 75,000، والنسبة لسنة ميلادية 365 يوماً 2.5777% ⇒ 1,933.28؛ وقيد محفوظ (غير مرحَّل) لا يدخل الحساب؛
 * - حفظ الإقرار وترحيل قيده (مصروف الزكاة / مخصص الزكاة)، وحذف إقرار له قيد مرفوض؛
 * - تصنيف لا يناسب نوع الحساب مرفوض؛ مستأجر آخر لا يرى الإقرار.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailA = `zakat-a-${stamp}@example.com`;
const emailB = `zakat-b-${stamp}@example.com`;
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

describe("zakat (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.zakatDeclaration.deleteMany({ where: { tenantId } });
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  });

  it("computes the base from posted books, saves the declaration and posts its entry", async () => {
    const a = await register({ tenantName: "مستأجر الزكاة", businessActivity: "retail", name: "المالك", email: emailA, password });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر آخر", businessActivity: "retail", name: "آخر", email: emailB, password });
    tenantIds.push(b.tenant.id);
    const token = a.accessToken;
    const userId = (await prisma.user.findFirstOrThrow({ where: { tenantId: a.tenant.id } })).id;
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const posting = (where: object) => prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, ...where }, orderBy: { code: "asc" } });
    const cash = await posting({ isBankOrCash: true });
    const capital = await posting({ type: "equity" });
    const revenue = await posting({ type: "revenue" });
    // حساب أصل بسيط بلا ارتباطات جانبية (أصول ثابتة/مخزون/سلف) حتى يقيس الاختبار الزكاة وحدها
    const fixedAsset = await prisma.account.create({
      data: { tenantId: a.tenant.id, companyId: company.id, name: "معدات اختبار الزكاة", type: "asset", code: `9${String(stamp).slice(-5)}`, level: 4, isPosting: true },
    });
    const expense = await posting({ type: "expense" });
    const liability = await posting({ type: "liability" });

    // تصنيف صريح للأصل الثابت (محسوم) — والتصنيف غير المناسب لنوع الحساب مرفوض
    expect((await call("PUT", `/zakat/accounts/${fixedAsset.id}/treatment`, token, { treatment: "deductible_non_current_asset" })).status).toBe(200);
    expect((await call("PUT", `/zakat/accounts/${capital.id}/treatment`, token, { treatment: "current_asset" })).status).toBe(400);

    const entry = (date: string, debit: string, credit: string, amount: number, post = true) =>
      createJournalEntry(a.tenant.id, userId, {
        companyId: company.id, date: new Date(`${date}T00:00:00.000Z`), memo: "اختبار", post,
        lines: [{ accountId: debit, debit: amount, credit: 0 }, { accountId: credit, debit: 0, credit: amount }],
      } as never);
    await entry("2025-01-01", cash.id, capital.id, 100_000);
    await entry("2025-03-01", fixedAsset.id, cash.id, 60_000);
    await entry("2025-06-01", cash.id, revenue.id, 30_000);
    await entry("2025-07-01", cash.id, revenue.id, 999_999, false); // محفوظ — لا يُحتسب

    const qs = new URLSearchParams({
      companyId: company.id, periodStart: "2025-01-01", periodEnd: "2025-12-31",
      adjustments: JSON.stringify([{ label: "مصروفات غير جائزة الحسم", amount: 5000 }]),
    });
    const computed = await call("GET", `/zakat/compute?${qs}`, token);
    expect(computed.status).toBe(200);
    expect(computed.body.inputs.equity).toBe(130_000);
    expect(computed.body.inputs.deductibleNonCurrentAssets).toBe(60_000);
    expect(computed.body.result.adjustedNetProfit).toBe(35_000);
    expect(computed.body.result.zakatBase).toBe(75_000);
    expect(computed.body.ratePercent).toBeCloseTo(2.5777, 4);
    expect(computed.body.result.zakatDue).toBe(1933.28);

    const saved = await call("POST", "/zakat/declarations", token, {
      companyId: company.id, periodStart: "2025-01-01", periodEnd: "2025-12-31",
      adjustments: [{ label: "مصروفات غير جائزة الحسم", amount: 5000 }],
    });
    expect(saved.status).toBe(201);
    expect(Number(saved.body.zakatDue)).toBe(1933.28);

    const posted = await call("POST", `/zakat/declarations/${saved.body.id}/post`, token, { expenseAccountId: expense.id, payableAccountId: liability.id });
    expect(posted.status).toBe(200);
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.body.journalEntryId }, include: { lines: true } });
    expect(je.date.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(je.lines.find((l) => l.accountId === expense.id)?.debit.toString()).toBe("1933.28");
    expect(je.lines.find((l) => l.accountId === liability.id)?.credit.toString()).toBe("1933.28");

    expect((await call("DELETE", `/zakat/declarations/${saved.body.id}`, token)).status).toBe(409);
    expect((await call("GET", `/zakat/declarations/${saved.body.id}`, b.accessToken)).status).toBe(404);
  });
});
