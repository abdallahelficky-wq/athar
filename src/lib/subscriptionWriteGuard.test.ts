import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ATTACHMENT_ENTITY_MODELS, guardedModels, modelClassification, PARENT_MODELS, TENANT_LEVEL_MODELS } from "./subscriptionWriteGuard";
import { attachmentEntityTypeEnum } from "../modules/attachments/attachments.schemas";
import { companySubscriptionSchema } from "../modules/platformAdmin/platformAdmin.schemas";

/** حارس الكتابة (P4): الجداول التي يحرسها مأخوذة من مخطط Prisma نفسه (كل جدول بعمود companyId)، لا من قائمة يدوية */
describe("subscription write guard coverage", () => {
  it("guards every company-owned table that a request writes, and none of the subscription bookkeeping tables", () => {
    const guarded = guardedModels();
    for (const model of ["Company", "JournalEntry", "SalesInvoice", "Receipt", "Warehouse", "StockMovement", "Customer", "Employee", "FixedAsset"]) {
      expect(guarded, model).toContain(model);
    }
    for (const exempt of ["AuditLog", "CompanySubscription", "CompanyPosUser"]) expect(guarded).not.toContain(exempt);
    expect(guarded.length).toBeGreaterThan(40);
  });

  // مراجعة #164: كل جدول في المخطط مصنَّف — جدول جديد بلا تصنيف يُفشل هذا الاختبار حتى يُقرَّر: له شركة مباشرة، أو عبر أصل، أو معفى بسبب
  it("classifies every Prisma model: company-owned, resolved through a parent, attachment, or tenant/platform-level with a reason", () => {
    const models = Prisma.dmmf.datamodel.models;
    const unclassified = models.map((m) => m.name).filter((name) => modelClassification(name) === null);
    expect(unclassified, "جداول بلا تصنيف في subscriptionWriteGuard.ts").toEqual([]);
    const hasCompanyId = (name: string) => models.find((m) => m.name === name)!.fields.some((f) => f.name === "companyId" && f.kind === "scalar");
    for (const name of [...Object.keys(PARENT_MODELS), ...Object.keys(TENANT_LEVEL_MODELS), "Attachment"]) {
      expect(hasCompanyId(name), `${name} له companyId فلا يُصنَّف إلا "company"`).toBe(false);
    }
    for (const [name, reason] of Object.entries(TENANT_LEVEL_MODELS)) expect(reason.length, name).toBeGreaterThan(10);
  });

  it("resolves every parent path through a real relation that ends at a company-owned table", () => {
    const models = Prisma.dmmf.datamodel.models;
    for (const [name, { fk, relation, parent }] of Object.entries(PARENT_MODELS)) {
      const field = models.find((m) => m.name === name)!.fields.find((f) => f.name === relation);
      expect(field?.kind, `${name}.${relation}`).toBe("object");
      expect(field?.type, `${name}.${relation}`).toBe(parent);
      expect(field?.relationFromFields, `${name}.${relation}`).toEqual([fk]);
      expect(["company", "parent"], `${name} → ${parent}`).toContain(modelClassification(parent));
      expect(guardedModels(), name).toContain(name);
    }
    expect(guardedModels()).toContain("EmployeePayrollComponent");
    expect(guardedModels()).toContain("SalesInvoiceLine");
    expect(guardedModels()).toContain("JournalEntryLine");
  });

  it("resolves every attachment entity type the attachments API accepts", () => {
    expect(Object.keys(ATTACHMENT_ENTITY_MODELS).sort()).toEqual([...attachmentEntityTypeEnum.options].sort());
    for (const model of Object.values(ATTACHMENT_ENTITY_MODELS)) expect(["company", "parent"], model).toContain(modelClassification(model));
  });

  it("accepts only a real subscription term from the admin API: end after start", () => {
    const base = { plan: "basic", billingPeriod: "yearly", status: "active", enforced: true, expectedVersion: null };
    expect(companySubscriptionSchema.safeParse({ ...base, currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01" }).success).toBe(true);
    expect(companySubscriptionSchema.safeParse({ ...base, currentPeriodStart: "2027-01-01", currentPeriodEnd: "2026-01-01" }).success).toBe(false);
    expect(companySubscriptionSchema.safeParse({ ...base, currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01", posUsers: -1 }).success).toBe(false);
  });
});
