import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { runTemplate } from "./recurringJournals.service";

/**
 * القيود الدورية على Postgres حقيقي — القالب عبر HTTP، والمواعيد عبر runTemplate نفسها (مسار المُجدوِل):
 * - تدارك المواعيد الفائتة بتواريخها الأصلية (آخر الشهر: 31 يناير، 28 فبراير)، وقيود متوازنة بأسطر القالب؛
 * - تشغيلان متزامنان لا يكرّران موعداً (حجز RecurringJournalRun الفريد)، وتشغيل ثانٍ لا ينشئ شيئاً؛
 * - autoPost=false ⇒ قيد محفوظ غير مرحَّل؛ فترة مقفلة ⇒ lastError ويبقى الموعد كما هو؛
 * - قالب غير متوازن مرفوض؛ مستأجر آخر لا يرى القالب.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailA = `recurring-a-${stamp}@example.com`;
const emailB = `recurring-b-${stamp}@example.com`;
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

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("recurring journal entries (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.recurringJournalTemplate.deleteMany({ where: { tenantId } });
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  });

  it("creates due entries once, on their own dates, and stops on a closed period", async () => {
    const a = await register({ tenantName: "مستأجر قيود دورية", businessActivity: "retail", name: "المالك", email: emailA, password });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر آخر", businessActivity: "retail", name: "آخر", email: emailB, password });
    tenantIds.push(b.tenant.id);
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const [expense, cash] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, type: "expense" } }),
      prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, isBankOrCash: true } }),
    ]);
    const body = {
      companyId: company.id, name: "إيجار المكتب", memo: "إيجار شهري", frequency: "monthly", dayOfMonth: 31,
      startDate: "2026-01-01", autoPost: true,
      lines: [{ accountId: expense.id, debit: 5000, credit: 0 }, { accountId: cash.id, debit: 0, credit: 5000 }],
    };

    const unbalanced = await call("POST", "/recurring-journals", a.accessToken, { ...body, lines: [{ accountId: expense.id, debit: 5000, credit: 0 }, { accountId: cash.id, debit: 0, credit: 4000 }] });
    expect(unbalanced.status).toBe(400);

    const created = await call("POST", "/recurring-journals", a.accessToken, body);
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(String(created.body.nextRunDate).slice(0, 10)).toBe("2026-01-31");

    // تشغيلان متزامنان حتى 15 مارس: موعدان فقط (31 يناير، 28 فبراير)
    await Promise.all([runTemplate(id, d("2026-03-15")), runTemplate(id, d("2026-03-15"))]);
    const runs = await prisma.recurringJournalRun.findMany({ where: { templateId: id }, include: { journalEntry: { include: { lines: true } } }, orderBy: { periodDate: "asc" } });
    expect(runs.map((r) => r.periodDate.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28"]);
    for (const r of runs) {
      expect(r.journalEntry?.status).toBe("posted");
      expect(r.journalEntry?.date.toISOString().slice(0, 10)).toBe(r.periodDate.toISOString().slice(0, 10));
      const dr = r.journalEntry!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const cr = r.journalEntry!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(dr).toBe(5000);
      expect(cr).toBe(5000);
    }
    expect((await runTemplate(id, d("2026-03-15"))).created).toBe(0);
    expect((await prisma.recurringJournalTemplate.findUniqueOrThrow({ where: { id } })).nextRunDate?.toISOString().slice(0, 10)).toBe("2026-03-31");

    // مسودة بدل ترحيل
    const edited = await call("PUT", `/recurring-journals/${id}`, a.accessToken, { ...body, autoPost: false });
    expect(edited.status).toBe(200);
    expect(String(edited.body.nextRunDate).slice(0, 10)).toBe("2026-03-31");
    await runTemplate(id, d("2026-04-05"));
    const march = await prisma.recurringJournalRun.findFirstOrThrow({ where: { templateId: id, periodDate: d("2026-03-31") }, include: { journalEntry: true } });
    expect(march.journalEntry?.status).toBe("saved");

    // فترة مقفلة حتى 30 أبريل: خطأ مسجَّل والموعد ثابت
    await prisma.company.update({ where: { id: company.id }, data: { fiscalYearClosingDate: d("2026-04-30") } });
    const blocked = await runTemplate(id, d("2026-05-10"));
    expect(blocked.created).toBe(0);
    const after = await prisma.recurringJournalTemplate.findUniqueOrThrow({ where: { id } });
    expect(after.lastError).toMatch(/فترة مُقفلة/);
    expect(after.nextRunDate?.toISOString().slice(0, 10)).toBe("2026-04-30");

    // عزل المستأجر
    expect((await call("GET", `/recurring-journals/${id}`, b.accessToken)).status).toBe(404);
  });
});
