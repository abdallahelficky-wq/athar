import { describe, expect, it, vi } from "vitest";

// CHECK 1 (مراجعة PR #76): "رصيد العميل" (getCustomerStatement) لا يقرأ SalesInvoice.status
// إطلاقاً — يُبنى بالكامل من أسطر JournalEntryLine المرتبطة بحساب ذمم العميل (راجع
// buildPartyStatement/aggregateAccountBalances في هذا الملف). فاتورة pending_submission/
// zatca_accepted_posting_incomplete لا قيد محاسبي لها بعد بتصميم مسار الترحيل الآمن على ثلاث
// مراحل (salesInvoices.service.ts) — فلا يمكنها منطقياً الظهور في هذا الرصيد إطلاقاً، بصرف النظر
// عن حالتها. هذا الاختبار يثبت أن الرصيد المحسوب هنا مبنيّ حصراً مما يُكتَب فعلياً في القيود (سطر
// واحد فقط، من الفاتورة المرحّلة)، لا من مجموع جدول SalesInvoice بأي شكل مباشر.
const TENANT_ID = "tenant-1";
const CUSTOMER_ID = "customer-1";
const COMPANY_ID = "company-1";
const RECEIVABLE_ACCOUNT_ID = "receivable-account-1";

// الجدول الحقيقي الوحيد الذي يُبنى منه الرصيد: سطر قيد واحد فقط، يخص الفاتورة "المرحّلة" حصراً —
// لا سطر إطلاقاً لفاتورتَي pending_submission/zatca_accepted_posting_incomplete (لأنهما لم
// تُنشئا قيداً بعد أصلاً)، بالضبط كما يحدث فعلياً في قاعدة بيانات حقيقية بعد هذا الإصلاح.
const JOURNAL_LINES = [
  {
    accountId: RECEIVABLE_ACCOUNT_ID,
    debit: 100,
    credit: 0,
    journalEntryId: "je-posted-invoice",
    description: null,
    journalEntry: { tenantId: TENANT_ID, companyId: COMPANY_ID, date: new Date("2026-01-08"), memo: "فاتورة مبيعات INV-00004 — عميل تجريبي", company: { name: "شركة تجريبية", shortName: null } },
    account: { name: "ذمم مدينة" },
  },
];

vi.mock("../../lib/prisma", () => ({
  prisma: {
    customer: { findFirst: vi.fn() },
    journalEntryLine: {
      findMany: vi.fn(() => Promise.resolve(JOURNAL_LINES)),
      aggregate: vi.fn(() => Promise.resolve({ _sum: { debit: 0, credit: 0 } })),
    },
  },
}));
vi.mock("../../lib/partyAccounts", () => ({ resolvePartyAccountId: vi.fn() }));

import { prisma } from "../../lib/prisma";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { getCustomerStatement } from "./reports.service";

describe("getCustomerStatement excludes pending_submission / zatca_accepted_posting_incomplete invoices (no journal entry exists for them)", () => {
  it("computes the balance from only the one journal line that exists — the posted invoice's — never inflated by unposted ones", async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: CUSTOMER_ID, tenantId: TENANT_ID, companyId: COMPANY_ID, name: "عميل تجريبي" } as never);
    vi.mocked(resolvePartyAccountId).mockResolvedValue(RECEIVABLE_ACCOUNT_ID);

    const statement = await getCustomerStatement(TENANT_ID, CUSTOMER_ID);

    // 100 فقط — مبلغ الفاتورة المرحّلة الوحيدة التي لها قيد فعلي. لو أي كود مستقبلي بدأ يجمع
    // SalesInvoice.grandTotal مباشرة (متجاوزاً القيود) ليشمل فواتير غير مرحّلة، هذا الرقم سيرتفع
    // فوراً (2000+4000+100 = 6100 لو أُضيفت الحالتان الجديدتان بالخطأ، كما في اختبار salesReports
    // المقابل).
    expect(statement.closingBalance).toBe(100);
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0].debit).toBe(100);
  });
});
