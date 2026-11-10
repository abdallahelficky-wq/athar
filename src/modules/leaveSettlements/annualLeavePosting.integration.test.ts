import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
guardAgainstUnsafeIntegrationTestDatabase();

let server: Server, base = "", token = "", tenantId = "", companyId = "", otherTenant = "", otherToken = "";
let employeeId = "", employeeAccountId = "", deptSalaryAccountId = "", leaveAccountId = "", draftId = "";
async function call(method: string, path: string, body?: unknown, auth = token) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
const pick = (l: { accountId: string; debit: unknown; credit: unknown }) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) });

describe("posting an annual leave draft through the actual HTTP handlers", () => {
  beforeAll(async () => {
    server = createApp().listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const other of [false, true]) {
      const r = await register({ tenantName: `leave-post-${Date.now()}-${other}`, businessActivity: "manufacturing", name: "Owner", email: `leave-post-${Date.now()}-${other}@example.com`, password: "Str0ng-Pass!" });
      if (other) { otherTenant = r.tenant.id; otherToken = r.accessToken; }
      else { tenantId = r.tenant.id; token = r.accessToken; companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id; }
    }
    // حسابا مصروف من شجرة الشركة التي أنشأها التسجيل نفسه: واحد لرواتب القسم وآخر للإجازات
    const expense = await prisma.account.findMany({ where: { tenantId, companyId, type: "expense", isPosting: true, isActive: true, isArchived: false }, orderBy: { code: "desc" }, take: 2 });
    expect(expense).toHaveLength(2);
    [deptSalaryAccountId, leaveAccountId] = expense.map((a) => a.id);
    const dept = await call("POST", "/departments", { name: "المصنع", nameEn: "Factory", companyId, salaryExpenseAccountId: deptSalaryAccountId });
    expect(dept.status).toBe(201);
    const employee = await call("POST", "/employees", { companyId, name: "Posting employee", hireDate: "2025-09-28", basicSalary: 2300, gosiApplicable: false, departmentId: dept.body.id, department: "المصنع" });
    expect(employee.status).toBe(201);
    employeeId = employee.body.id;
    employeeAccountId = (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).accountId!;
    expect(employeeAccountId).toBeTruthy();
    const draft = await call("POST", "/leave-settlements/annual-drafts", { companyId, employeeId, leaveStartDate: "2026-11-13", balanceMode: "all", salaryMode: "until_leave",
      otherAdditions: 487.1, additionsReason: "استكمال 30 يوم حسب التعميد" });
    expect(draft.status).toBe(201);
    expect(draft.body.snapshot.net).toBe(3220);
    draftId = draft.body.id;
  }, 60000);
  afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    if (otherTenant) await prisma.tenant.delete({ where: { id: otherTenant } });
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses to preview or post without a leave expense account, and other tenants never see the draft", async () => {
    const r = await call("POST", `/leave-settlements/annual-drafts/${draftId}/journal-preview`, {});
    expect(r.status).toBe(400);
    expect((await call("POST", `/leave-settlements/annual-drafts/${draftId}/journal-preview`, { leaveAccountId }, otherToken)).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/leave-settlements/annual-drafts/${draftId}/post`, { leaveAccountId }, otherToken)).status).toBeGreaterThanOrEqual(400);
    expect(await prisma.journalEntry.count({ where: { tenantId, sourceModule: "leave_settlement" } })).toBe(0);
  });

  it("posts salary to the department account, leave to the leave account, additions to other allowances, and the net to the employee", async () => {
    const preview = await call("POST", `/leave-settlements/annual-drafts/${draftId}/journal-preview`, { leaveAccountId });
    expect(preview.status).toBe(200);
    expect(preview.body.net).toBe(3220);
    const posted = await call("POST", `/leave-settlements/annual-drafts/${draftId}/post`, { leaveAccountId });
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe("posted");

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.body.journalEntryId }, include: { lines: true } });
    expect(entry).toMatchObject({ status: "posted", sourceModule: "leave_settlement", companyId });
    const lines = entry.lines.map(pick);
    // ما عُرض في المعاينة هو ما رُحِّل بالضبط
    expect(lines).toEqual(preview.body.lines.map(pick));
    const additionsAccountId = preview.body.accounts.additionsAccountId;
    expect(additionsAccountId).toBeTruthy();
    expect(lines).toEqual(expect.arrayContaining([
      { accountId: deptSalaryAccountId, debit: 920, credit: 0 },
      { accountId: leaveAccountId, debit: 1812.9, credit: 0 },
      { accountId: additionsAccountId, debit: 487.1, credit: 0 },
      { accountId: employeeAccountId, debit: 0, credit: 3220 },
    ]));
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBeCloseTo(0, 2);

    const settlement = await prisma.leaveSettlement.findUniqueOrThrow({ where: { id: posted.body.leaveSettlementId } });
    expect(Number(settlement.netAmount)).toBe(3220);
    expect(settlement.journalEntryId).toBe(entry.id);
    expect(entry.sourceId).toBe(settlement.id);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).leaveStatus).toBe("onLeave");
  });

  it("locks a posted draft: no second posting, edit or delete", async () => {
    expect((await call("POST", `/leave-settlements/annual-drafts/${draftId}/post`, { leaveAccountId })).status).toBe(400);
    expect((await call("PUT", `/leave-settlements/annual-drafts/${draftId}`, { companyId, employeeId, leaveStartDate: "2026-11-13" })).status).toBe(400);
    expect((await call("DELETE", `/leave-settlements/annual-drafts/${draftId}`)).status).toBe(400);
    expect(await prisma.journalEntry.count({ where: { tenantId, sourceModule: "leave_settlement" } })).toBe(1);
  });

  it("disburses the posted settlement from the employee's account", async () => {
    const settlement = await prisma.leaveSettlement.findFirstOrThrow({ where: { tenantId, employeeId } });
    const paid = await call("POST", `/leave-settlements/${settlement.id}/disburse`, { method: "cash", date: "2026-11-13" });
    expect(paid.status).toBe(200);
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: paid.body.disbursementJournalEntryId }, include: { lines: true } });
    expect(entry.lines.map(pick)).toEqual(expect.arrayContaining([{ accountId: employeeAccountId, debit: 3220, credit: 0 }]));
  });
});
