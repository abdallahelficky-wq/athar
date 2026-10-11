import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/i18n";
import "../../src/styles/global.css";
import { AuthProvider } from "../../src/context/AuthContext";
import InvoiceViewModal from "../../src/wired/sales/InvoiceViewModal";
import SalesReturnViewModal from "../../src/wired/sales/SalesReturnViewModal";

// INV-00202 كما يصل من GET /sales-invoices/:id: قياسية، مرحّلة قبل تخليصها ثم رُفضت عند إعادة إرسالها (BR-CO-15).
// ?template=modern|classicPro يختار قالب الشركة، و?doc=return يعرض إشعار دائن بدل الفاتورة.
const params = new URLSearchParams(location.search);
const template = params.get("template") || "modern";
const company = { id: "co-1", name: "مؤسسة المزارع الحديثة", vatNumber: "310000000000003", currency: "SAR", invoiceTemplate: template, brandColor: "#1f7a3a" };
const customer = { id: "cu-1", name: "المشتري", customerType: "business", vatNumber: "302043689600003", paymentTerms: "30 يوماً" };
const invoice = {
  id: "inv-202", tenantId: "t-1", companyId: "co-1", invoiceNumber: "INV-00202", date: "2026-10-05T00:00:00.000Z", status: "posted",
  zatcaStatus: "rejected", invoiceType: "standard", zatcaUuid: "uuid-202", icv: 202, grandTotal: "173.20", subtotal: "150.61", vatTotal: "22.59",
  zatcaResponseRaw: { validationResults: { errorMessages: [{ code: "BR-CO-15", message: "BT-112 = BT-109 + BT-110" }] } },
  company, customer, branch: null, receiptAllocations: [], emailLogs: [], creditNotes: [],
  lines: [{ id: "l-1", description: "علف", quantity: "33.5", unitPrice: "5.17", discountPct: "0", subtotal: "150.61", vat: "22.59", total: "173.20", account: { name: "إيراد" } }],
};
const salesReturn = {
  id: "ret-9", companyId: "co-1", returnNumber: "RET-00009", date: "2026-10-06T00:00:00.000Z", status: "pending_submission", zatcaStatus: "rejected",
  zatcaUuid: "uuid-ret", icv: 203, grandTotal: "11.50", subtotal: "10.00", vatTotal: "1.50", reason: "مرتجع", company, customer,
  zatcaResponseRaw: { validationResults: { errorMessages: [{ code: "BR-KSA-63", message: "عنوان المشتري" }] } },
  lines: [{ id: "rl-1", description: "علف", quantity: "1", unitPrice: "11.5", discountPct: "0", subtotal: "10.00", vat: "1.50", total: "11.50", account: { name: "إيراد" } }],
};
window.__changes = [];
const onChanged = (m) => window.__changes.push(m);
createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <MemoryRouter>
      {params.get("doc") === "return"
        ? <SalesReturnViewModal salesReturn={salesReturn} companies={[company]} onClose={() => {}} onChanged={onChanged} />
        : <InvoiceViewModal invoice={invoice} companies={[company]} onClose={() => {}} onChanged={onChanged} />}
    </MemoryRouter>
  </AuthProvider>,
);
