import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { register } from "../modules/auth/auth.service";

/**
 * الاستعلامات التي يشغّلها المالك على الإنتاج (scripts/sql/*.sql واستعلام الأعمار القديم) كود يُختبَر — CLAUDE.md القاعدة 3.
 * قاعدة فيها مستأجران تتشارك شركتاهما الاسم نفسه (ويطابق نمط "تيسم" في استعلام الأعمار)، بمبالغ مختلفة: كل استعلام يجب
 * أن يُظهر معرّف الشركة وأن يُخرج الشركتين منفصلتين لا مدموجتين. في #126 وُجد التجميع باسم الشركة في خمسة استعلامات.
 * استعلام جديد في scripts/sql يدخل هذا الاختبار تلقائياً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const ROOT = path.resolve(__dirname, "../..");
const QUERIES = [
  ...readdirSync(path.join(ROOT, "scripts/sql")).filter((f) => f.endsWith(".sql")).map((f) => `scripts/sql/${f}`),
  "scripts/aging-old-logic.sql",
];
const stamp = Date.now();
const SHARED_NAME = `تيسم برو ${stamp}`;
const fixture: { tenantId: string; companyId: string }[] = [];

describe("production queries are correct on a multi-tenant database", () => {
  beforeAll(async () => {
    for (const [k, amount] of [["a", 1000], ["b", 7]] as const) {
      const r = await register({ tenantName: `استعلامات ${k} ${stamp}`, businessActivity: "retail", name: "م", email: `pq-${k}-${stamp}@example.com`, password: "Str0ng-Pass!" });
      const tenantId = r.tenant.id;
      const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
      await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
      const dept = await prisma.department.create({ data: { tenantId, companyId: company.id, name: "المبيعات" } });
      const cash = (await prisma.account.findFirstOrThrow({ where: { companyId: company.id, code: "111001" } })).id;
      const rev = (await prisma.account.findFirstOrThrow({ where: { companyId: company.id, type: "revenue", isPosting: true } })).id;
      const group = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, type: "asset", level: 3, isPosting: false } });
      const pooled = await prisma.account.create({
        data: { tenantId, companyId: company.id, parentId: group.id, code: `99${k === "a" ? 1 : 2}${String(stamp).slice(-4)}`, name: "حساب جاري - شركات المجموعة", type: "asset", level: 4, isPosting: true },
      });
      const customer = await prisma.customer.create({ data: { tenantId, companyId: company.id, name: "عميل" } });
      for (let i = 0; i < 2; i++) {
        await prisma.journalEntry.create({
          data: {
            tenantId, companyId: company.id, date: new Date("2026-07-15"), status: "posted", entryNumber: `PQ-${k}-${i}-${stamp}`, createdBy: r.user.id,
            lines: { create: [
              { accountId: i === 0 ? pooled.id : cash, debit: amount, credit: 0, departmentId: dept.id },
              // سطر بلا قسم في قيد له أقسام — لدى المستأجر "a" وحده
              { accountId: rev, debit: 0, credit: amount, departmentId: i === 0 && k === "a" ? null : dept.id },
            ] },
          } as never,
        });
      }
      await prisma.salesInvoice.create({
        data: { tenantId, companyId: company.id, customerId: customer.id, invoiceNumber: `PQ-INV-${k}-${stamp}`, date: new Date("2026-07-10"), invoiceType: "simplified",
          status: "posted", subtotal: amount, vatTotal: 0, grandTotal: amount, zatcaStatus: "reported", zatcaSubmittedAt: new Date("2026-07-10") } as never,
      });
      fixture.push({ tenantId, companyId: company.id });
    }
  }, 120_000);

  afterAll(async () => {
    for (const f of fixture) await prisma.auditLog.deleteMany({ where: { tenantId: f.tenantId } });
  });

  it.each(QUERIES)("%s exposes company_id and keeps two same-named companies apart", async (file) => {
    const sql = readFileSync(path.join(ROOT, file), "utf8");
    const all: Record<string, unknown>[] = await prisma.$queryRawUnsafe(sql);
    const ids = new Set(fixture.map((f) => f.companyId));
    const rows = all.filter((r) => ids.has(r.company_id as string));
    expect(all.length === 0 || "company_id" in all[0], `${file} لا يُظهر company_id`).toBe(true);
    expect(new Set(rows.map((r) => r.company_id)).size, `${file} دمج الشركتين أو أسقط إحداهما`).toBe(2);
  });
});
