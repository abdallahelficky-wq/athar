import { describe, expect, it } from "vitest";
import type { Router } from "express";
import { salesInvoiceRoutes } from "../modules/salesInvoices/salesInvoices.routes";
import { salesReturnRoutes } from "../modules/salesReturns/salesReturns.routes";
import { salesDebitNoteRoutes } from "../modules/salesDebitNotes/salesDebitNotes.routes";
import { quotationRoutes } from "../modules/quotations/quotations.routes";
import { posRoutes } from "../modules/pos/pos.routes";
import { stableRoutes } from "../modules/stables/stables.routes";
import { reportScheduleRoutes } from "../modules/reportSchedules/reportSchedules.routes";
import { companyZatcaRoutes } from "../modules/companiesZatca/companiesZatca.routes";
import { companyRoutes } from "../modules/companies/companies.routes";
import { customerRoutes } from "../modules/customers/customers.routes";
import { journalEntryRoutes } from "../modules/journalEntries/journalEntries.routes";
import { aiRoutes } from "../modules/ai/ai.routes";
import { authRoutes } from "../modules/auth/auth.routes";
import { FEATURE_MODULES, RECORD_TABLES } from "./subscriptionEnforcement";

/**
 * كل مسار يستدعي خدمة خارجية (زاتكا، البريد عبر Resend، نموذج Claude) قبل أن يكتب — مراجعة #163. لشركة مُنفَّذة يجب أن يرفضه الفحص
 * المسبق قبل المعالج، لا حارس الكتابة بعد النداء الخارجي. هذا الاختبار يثبت لكل مسار: أنه موجود، ويحمل requirePositionAction بإجراء
 * كتابة (أو وحدة ميزة كـ AI)، وأن للفحص المسبق طريقاً لتحديد شركته. سلوك الرفض الفعلي (والعميل الخارجي لا يُستدعى) مختبَر عبر HTTP
 * في subscriptionEnforcement.integration.test.ts لممثّل من كل نوع.
 *
 * طرق التحديد: body = companyId في جسم JSON؛ multipart = companyId في نموذج الرفع (يُعاد الفحص بعد التحليل في validateBody)؛
 * record = :id سجلّ في RECORD_TABLES للوحدة؛ company = :id هو الشركة نفسها؛ params = :companyId في المسار؛ tenant = إدارة مستأجر
 * لا شركة (دعوة عضو) — تبقى على "عرض فقط" للمستأجر (D32) وحدّ المقاعد.
 */
type Resolve = "body" | "multipart" | "record" | "company" | "params" | "tenant";
type Entry = { router: Router; name: string; method: "post" | "patch" | "put"; path: string; external: "zatca" | "email" | "claude"; resolve: Resolve };

const R = (router: Router, name: string, method: Entry["method"], path: string, external: Entry["external"], resolve: Resolve): Entry => ({ router, name, method, path, external, resolve });

export const EXTERNAL_CALL_ROUTES: Entry[] = [
  R(salesInvoiceRoutes, "sales-invoices", "post", "/", "zatca", "body"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/post", "zatca", "record"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/resend-zatca", "zatca", "record"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/retry-zatca-submission", "zatca", "record"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/reissue-zatca", "zatca", "record"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/complete-zatca-posting", "zatca", "record"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/send-email", "email", "record"),
  R(salesInvoiceRoutes, "sales-invoices", "post", "/:id/resend-email", "email", "record"),
  R(salesReturnRoutes, "sales-returns", "post", "/", "zatca", "body"),
  R(salesReturnRoutes, "sales-returns", "post", "/:id/post", "zatca", "record"),
  R(salesReturnRoutes, "sales-returns", "post", "/:id/retry-zatca-submission", "zatca", "record"),
  R(salesReturnRoutes, "sales-returns", "post", "/:id/reissue-zatca", "zatca", "record"),
  R(salesReturnRoutes, "sales-returns", "post", "/:id/complete-zatca-posting", "zatca", "record"),
  R(salesReturnRoutes, "sales-returns", "post", "/:id/send-email", "email", "record"),
  R(salesDebitNoteRoutes, "sales-debit-notes", "post", "/", "zatca", "body"),
  R(salesDebitNoteRoutes, "sales-debit-notes", "post", "/:id/post", "zatca", "record"),
  R(salesDebitNoteRoutes, "sales-debit-notes", "post", "/:id/retry-zatca-submission", "zatca", "record"),
  R(salesDebitNoteRoutes, "sales-debit-notes", "post", "/:id/reissue-zatca", "zatca", "record"),
  R(salesDebitNoteRoutes, "sales-debit-notes", "post", "/:id/complete-zatca-posting", "zatca", "record"),
  R(quotationRoutes, "quotations", "post", "/:id/convert-to-invoice", "zatca", "record"),
  R(posRoutes, "pos", "post", "/sales", "zatca", "body"),
  R(stableRoutes, "stables", "post", "/contracts/:id/send-email", "email", "record"),
  R(stableRoutes, "stables", "post", "/lessons/:id/invoice", "zatca", "record"),
  R(reportScheduleRoutes, "companies/:companyId", "post", "/report-schedule/send-now", "email", "params"),
  R(companyZatcaRoutes, "companies/:id/zatca", "post", "/compliance", "zatca", "company"),
  R(companyZatcaRoutes, "companies/:id/zatca", "post", "/production", "zatca", "company"),
  R(companyZatcaRoutes, "companies/:id/zatca", "post", "/compliance-steps/:stepKey/test", "zatca", "company"),
  R(companyRoutes, "companies", "post", "/:id/extract-document", "claude", "company"),
  R(customerRoutes, "customers", "post", "/:id/extract-document", "claude", "record"),
  R(journalEntryRoutes, "journal-entries", "post", "/from-document", "claude", "multipart"),
  R(aiRoutes, "ai", "post", "/ask", "claude", "body"),
  R(authRoutes, "auth", "post", "/invite", "email", "tenant"),
  R(authRoutes, "auth", "post", "/users/:id/resend-invite", "email", "tenant"),
];

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: { positionAction?: { resourceId: string; action: string } } }[] } };

function guardsOf(entry: Entry) {
  const layer = (entry.router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === entry.path && l.route.methods[entry.method]);
  if (!layer?.route) return null;
  return layer.route.stack.map((s) => s.handle.positionAction).filter((g): g is { resourceId: string; action: string } => !!g);
}

describe("routes that call ZATCA, send email or call Claude are covered by the subscription pre-check", () => {
  it.each(EXTERNAL_CALL_ROUTES.map((e) => [`${e.method.toUpperCase()} /${e.name}${e.path} (${e.external}, ${e.resolve})`, e] as const))("%s", (_label, entry) => {
    const guards = guardsOf(entry);
    expect(guards, "route exists").not.toBeNull();
    const enforcing = guards!.filter((g) => g.action !== "read" || FEATURE_MODULES.has(g.resourceId));
    expect(enforcing.length, "carries a write-action (or feature) requirePositionAction").toBeGreaterThan(0);
    if (entry.resolve === "record") {
      expect(enforcing.some((g) => (RECORD_TABLES[g.resourceId] ?? []).length > 0), "its :id table is mapped").toBe(true);
    }
    if (entry.resolve === "company") expect([companyRoutes, companyZatcaRoutes]).toContain(entry.router);
  });
});
