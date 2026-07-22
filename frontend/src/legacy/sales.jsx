import React, { useState, useMemo } from "react";
import {
  COMPANIES, STATIONS, CUSTOMER_TYPES, PAYMENT_TERMS, SALES_REVENUE_ACCOUNTS, VAT_RATE,
  emptyCustomerForm, invoiceTypeForCustomer, buildZatcaQrPayload, customerAccountBalance,
  invoicePaidAmount, nextDocNumber, fmt, fmt2,
} from "./constants";
import {
  Icon, TxIconBar, PrintShell, VoucherModal, QrImage, ExcelImportPanel, downloadCsv,
  printWithOrientation, MiniDonut, MiniBarChart, UnpostConfirm,
} from "./shared";

export function StationsModule({ sales, setSales, companyId }) {
  const companyStations = companyId === "all" ? STATIONS : STATIONS.filter((s) => s.company === companyId);
  const [form, setForm] = useState({
    stationId: companyStations[0]?.id || STATIONS[0].id,
    date: "2026-07-20",
    liters: "",
    pricePerLiter: "2.18",
    shiftNote: "",
  });

  const stationIds = new Set(companyStations.map((s) => s.id));
  const list = sales.filter((s) => stationIds.has(s.stationId));

  const addSale = () => {
    if (!form.liters || Number(form.liters) <= 0) return;
    setSales((prev) => [
      ...prev,
      {
        id: prev.length ? Math.max(...prev.map((s) => s.id)) + 1 : 1,
        ...form,
        liters: Number(form.liters),
        pricePerLiter: Number(form.pricePerLiter),
      },
    ]);
    setForm((f) => ({ ...f, liters: "", shiftNote: "" }));
  };

  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">تشغيل المحطات</span>
        <h2>متابعة مبيعات المحطات اليومية</h2>
      </div>

      {companyId !== "all" && companyStations.length === 0 ? (
        <div className="panel"><p className="empty">لا توجد محطات مرتبطة بهذا الكيان في هذا العرض التجريبي.</p></div>
      ) : (
        <>
          <div className="panel form-panel">
            <div className="form-grid">
              <label>
                المحطة
                <select value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })}>
                  {companyStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label>
                التاريخ
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label>
                الكمية (لتر)
                <input type="number" value={form.liters} onChange={(e) => setForm({ ...form, liters: e.target.value })} placeholder="0" />
              </label>
              <label>
                سعر اللتر
                <input type="number" step="0.01" value={form.pricePerLiter} onChange={(e) => setForm({ ...form, pricePerLiter: e.target.value })} />
              </label>
              <label className="memo-field">
                ملاحظة الوردية
                <input type="text" value={form.shiftNote} onChange={(e) => setForm({ ...form, shiftNote: e.target.value })} placeholder="مثال: وردية صباحية" />
              </label>
            </div>
            <button className="btn-primary" onClick={addSale}>تسجيل المبيعات</button>
          </div>

          <div className="panel">
            <table className="ledger-table">
              <thead>
                <tr><th>التاريخ</th><th>المحطة</th><th>لتر</th><th>سعر اللتر</th><th>الإجمالي</th><th>الوردية</th></tr>
              </thead>
              <tbody>
                {list.slice().reverse().map((r) => {
                  const st = STATIONS.find((s) => s.id === r.stationId);
                  return (
                    <tr key={r.id}>
                      <td>{r.date}</td>
                      <td>{st?.name}</td>
                      <td className="num">{fmt(r.liters)}</td>
                      <td className="num">{fmt2(r.pricePerLiter)}</td>
                      <td className="num">{fmt(r.liters * r.pricePerLiter)}</td>
                      <td>{r.shiftNote}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length === 0 && <p className="empty">لا توجد مبيعات مسجّلة بعد.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function CustomerDirectory({ customers, setCustomers, entries, companyId }) {
  const [form, setForm] = useState(emptyCustomerForm(companyId));
  const [statementCustomer, setStatementCustomer] = useState(null);
  const list = companyId === "all" ? customers : customers.filter((c) => c.company === companyId);

  const addCustomer = () => {
    if (!form.name) return;
    if (form.customerType === "business" && (!form.vatNumber || form.vatNumber.length !== 15)) return;
    setCustomers((prev) => [
      ...prev,
      { id: prev.length ? Math.max(...prev.map((c) => c.id)) + 1 : 1, ...form, creditLimit: Number(form.creditLimit || 0) },
    ]);
    setForm(emptyCustomerForm(companyId));
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>اسم العميل<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم المنشأة أو الفرد" /></label>
          <label>نوع العميل
            <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
              <option value="business">{CUSTOMER_TYPES.business}</option>
              <option value="individual">{CUSTOMER_TYPES.individual}</option>
            </select>
          </label>
          <label>الشركة (جهة التعامل)
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
              {COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          {form.customerType === "business" ? (
            <>
              <label>الرقم الضريبي (15 رقم)<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value.replace(/\D/g, "") })} placeholder="3xxxxxxxxxxxxx3" /></label>
              <label>رقم السجل التجاري<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} placeholder="4030xxxxxx" /></label>
            </>
          ) : (
            <label>رقم الهوية / الإقامة<input type="text" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} placeholder="10xxxxxxxx" /></label>
          )}

          <label>الجوال<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="05xxxxxxxx" /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="اختياري" /></label>

          <label>رقم المبنى<input type="text" value={form.buildingNo} onChange={(e) => setForm({ ...form, buildingNo: e.target.value })} placeholder="1234" /></label>
          <label>الشارع<input type="text" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></label>
          <label>الحي<input type="text" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></label>
          <label>المدينة<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>الرمز البريدي<input type="text" maxLength={5} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value.replace(/\D/g, "") })} /></label>
          <label>الرقم الإضافي<input type="text" maxLength={4} value={form.additionalNo} onChange={(e) => setForm({ ...form, additionalNo: e.target.value.replace(/\D/g, "") })} /></label>

          <label>شروط الدفع
            <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              {PAYMENT_TERMS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>حد الائتمان (ر.س)<input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="0" /></label>
        </div>
        <button className="btn-primary" onClick={addCustomer}>حفظ بيانات العميل</button>
        {form.customerType === "business" && form.vatNumber && form.vatNumber.length !== 15 && (
          <p className="note">⚠ الرقم الضريبي يجب أن يتكوّن من 15 رقماً وفق متطلبات هيئة الزكاة والضريبة والجمارك.</p>
        )}
      </div>

      <div className="hr-grid">
        {list.map((c) => {
          const balance = customerAccountBalance(entries, c.id);
          return (
            <div className="panel emp-card" key={c.id}>
              <div className="emp-card-head">
                <div>
                  <div className="emp-name">{c.name}</div>
                  <div className="emp-role">{CUSTOMER_TYPES[c.customerType]}</div>
                </div>
                <span className="status-badge">{c.paymentTerms}</span>
              </div>
              <div className="emp-meta-grid">
                <div><span>الرقم الضريبي</span><strong>{c.vatNumber || "—"}</strong></div>
                <div><span>السجل التجاري / الهوية</span><strong>{c.crNumber || c.nationalId || "—"}</strong></div>
                <div><span>المدينة</span><strong>{c.city || "—"}</strong></div>
                <div><span>الرصيد المستحق</span><strong className={balance > 0 ? "balance-bad" : ""}>{fmt(balance)} ر.س</strong></div>
              </div>
              <div className="entry-card-actions">
                <button className="btn-ghost" onClick={() => setStatementCustomer(c)}>كشف حساب</button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا يوجد عملاء مسجّلون لهذا الكيان بعد.</p>}
      </div>

      {statementCustomer && (() => {
        const rows = customerLedgerRows(entries, statementCustomer.id);
        const company = COMPANIES.find((c) => c.id === statementCustomer.company);
        return (
          <PrintShell
            subtitle="كشف حساب عميل"
            company={company}
            refNode={<div>تاريخ الكشف: <strong>2026-07-20</strong></div>}
            onClose={() => setStatementCustomer(null)}
          >
            <div className="voucher-meta">
              <div><span>اسم العميل</span><strong>{statementCustomer.name}</strong></div>
              <div><span>الرقم الضريبي</span><strong>{statementCustomer.vatNumber || "—"}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td><td>{r.memo}</td>
                    <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
                    <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
                    <td className="num strong">{fmt(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="empty">لا توجد حركات مسجّلة على هذا العميل.</p>}
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المبيعات: فواتير المبيعات ============ */

export function emptyInvoiceLine() { return { account: SALES_REVENUE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0, priceIncludesVat: true }; }

export function computeInvoiceLine(l) {
  const qty = Number(l.quantity || 0), price = Number(l.unitPrice || 0), disc = Number(l.discountPct || 0);
  const grossLine = qty * price * (1 - disc / 100);
  if (l.priceIncludesVat) {
    const subtotal = grossLine / (1 + VAT_RATE);
    const vat = grossLine - subtotal;
    return { subtotal, vat, total: grossLine };
  }
  const subtotal = grossLine;
  const vat = subtotal * VAT_RATE;
  return { subtotal, vat, total: subtotal + vat };
}

export function SalesInvoiceModule({ customers, invoices, setInvoices, receipts, entries, setEntries, companyId, unlockPin }) {
  const companyCustomers = companyId === "all" ? customers : customers.filter((c) => c.company === companyId);
  const [customerId, setCustomerId] = useState(companyCustomers[0]?.id || "");
  const [date, setDate] = useState("2026-07-20");
  const [lines, setLines] = useState([emptyInvoiceLine()]);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const list = invoices.filter((inv) => companyCustomers.some((c) => c.id === inv.customerId));
  const customer = customers.find((c) => c.id === customerId);

  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  const invType = customer ? invoiceTypeForCustomer(customer) : "simplified";

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyInvoiceLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const resetForm = () => { setEditingId(null); setLines([emptyInvoiceLine()]); };

  const postInvoiceLines = (customer, date, computedLines, invoiceNumber) => {
    const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
    const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
    const grandTotal = subtotal + vatTotal;
    const byAccount = {};
    computedLines.forEach((l) => { byAccount[l.account] = (byAccount[l.account] || 0) + l.subtotal; });
    const jLines = Object.entries(byAccount).map(([account, amount]) => ({
      account, costCenter: "", department: "المبيعات والتسويق", debit: 0, credit: amount, customerId: customer.id,
    }));
    jLines.push({ account: "ضريبة القيمة المضافة - مخرجات", costCenter: "", department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId: customer.id });
    jLines.push({ account: "ذمم مدينة", costCenter: "", department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId: customer.id });
    return { subtotal, vatTotal, grandTotal, jLines };
  };

  const saveInvoice = () => {
    if (!customer || grandTotal <= 0) return;
    const invoiceNumber = editingId ? invoices.find((i) => i.id === editingId).invoiceNumber : nextDocNumber(invoices, "INV", "invoiceNumber");
    const { jLines } = postInvoiceLines(customer, date, computedLines, invoiceNumber);
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: customer.company, date, memo: `فاتورة مبيعات ${invoiceNumber} — ${customer.name}`, lines: jLines }]);

    const qrPayload = buildZatcaQrPayload(
      COMPANIES.find((c) => c.id === customer.company)?.name || "",
      COMPANIES.find((c) => c.id === customer.company)?.vatNumber || "",
      `${date}T12:00:00`, grandTotal, vatTotal
    );
    const cleanLines = computedLines.map(({ account, description, quantity, unitPrice, discountPct, priceIncludesVat, subtotal: st, vat, total }) => ({ account, description, quantity: Number(quantity), unitPrice: Number(unitPrice), discountPct: Number(discountPct), priceIncludesVat, subtotal: st, vat, total }));

    if (editingId) {
      setInvoices((prev) => prev.map((i) => (i.id === editingId ? { ...i, customerId: customer.id, date, invoiceType: invType, lines: cleanLines, subtotal, vatTotal, grandTotal, journalEntryId: entryId, qrPayload, status: "posted" } : i)));
    } else {
      setInvoices((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((i) => i.id)) + 1 : 1, invoiceNumber, company: customer.company, customerId: customer.id, date, invoiceType: invType, lines: cleanLines, subtotal, vatTotal, grandTotal, journalEntryId: entryId, qrPayload, status: "posted" }]);
    }
    resetForm();
  };

  const startEdit = (inv) => {
    if (inv.status === "posted") return;
    setEditingId(inv.id);
    setCustomerId(inv.customerId); setDate(inv.date);
    setLines(inv.lines.map((l) => ({ ...l })));
    setPreviewInvoice(null);
  };

  const deleteInvoice = (inv) => {
    if (inv.status === "posted") return;
    if (!window.confirm(`حذف الفاتورة ${inv.invoiceNumber} نهائياً؟`)) return;
    setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
  };

  const unpostInvoice = (inv) => {
    setEntries((prev) => prev.filter((e) => e.id !== inv.journalEntryId));
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "draft", journalEntryId: null } : i)));
    setUnpostTarget(null);
  };

  const repostInvoice = (inv) => {
    const c = customers.find((x) => x.id === inv.customerId);
    if (!c) return;
    const { jLines } = postInvoiceLines(c, inv.date, inv.lines, inv.invoiceNumber);
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: c.company, date: inv.date, memo: `فاتورة مبيعات ${inv.invoiceNumber} — ${c.name}`, lines: jLines }]);
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "posted", journalEntryId: entryId } : i)));
  };

  const exportInvoiceCsv = (inv) => {
    const c = customers.find((x) => x.id === inv.customerId);
    const rows = [["الوصف", "الكمية", "سعر الوحدة", "خصم %", "قبل الضريبة", "الضريبة", "الإجمالي"]];
    inv.lines.forEach((l) => rows.push([l.description || l.account, l.quantity, l.unitPrice, l.discountPct, l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2)]));
    rows.push(["الإجمالي", "", "", "", inv.subtotal.toFixed(2), inv.vatTotal.toFixed(2), inv.grandTotal.toFixed(2)]);
    downloadCsv(`${inv.invoiceNumber}_${c?.name || ""}.csv`, rows);
  };

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل الفاتورة {invoices.find((i) => i.id === editingId)?.invoiceNumber}</div>}
        <div className="form-grid header-grid">
          <label>العميل
            <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
              {companyCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">نوع الفاتورة (تلقائي)
            <input type="text" readOnly value={invType === "standard" ? "فاتورة ضريبية قياسية (B2B)" : "فاتورة ضريبية مبسّطة (B2C)"} />
          </label>
        </div>
        {companyCustomers.length === 0 && <p className="empty">لا يوجد عملاء مسجّلون لهذا الكيان — أضف عميلاً من تبويب "العملاء" أولاً.</p>}

        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الحساب</th><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>شامل الضريبة؟</th><th>خصم %</th><th>الإجمالي شامل الضريبة</th><th></th></tr></thead>
            <tbody>
              {computedLines.map((l, idx) => (
                <tr key={idx}>
                  <td>
                    <select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}>
                      {SALES_REVENUE_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={l.description} onChange={(e) => updateLine(idx, "description", e.target.value)} placeholder="وصف الصنف/الخدمة" /></td>
                  <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, "quantity", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, "unitPrice", e.target.value)} placeholder="0.00" /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={l.priceIncludesVat} onChange={(e) => updateLine(idx, "priceIncludesVat", e.target.checked)} title="السعر شامل الضريبة" /></td>
                  <td><input type="number" className="amount-input" value={l.discountPct} onChange={(e) => updateLine(idx, "discountPct", e.target.value)} /></td>
                  <td className="num">{fmt2(l.total)}</td>
                  <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="foot-label" colSpan={6}>الإجمالي</td>
                <td className="num">{fmt2(grandTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="note">علّم "شامل الضريبة" لو السعر المُدخل شامل ١٥٪ ضريبة بالفعل؛ ألغِ العلامة لو السعر قبل الضريبة.</p>

        <div className="preview-box">
          <div className="preview-row"><span>الإجمالي قبل الضريبة</span><strong>{fmt(subtotal)} ر.س</strong></div>
          <div className="preview-row"><span>ضريبة القيمة المضافة (15٪)</span><strong>{fmt(vatTotal)} ر.س</strong></div>
          <div className="preview-row net-row"><span>الإجمالي شامل الضريبة</span><strong>{fmt(grandTotal)} ر.س</strong></div>
        </div>

        <div className="journal-actions">
          <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
          <div className="form-btn-group">
            {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء التعديل</button>}
            <button className="btn-primary" onClick={saveInvoice} disabled={!customer || grandTotal <= 0}>{editingId ? "حفظ التعديلات وإعادة الترحيل" : "حفظ وترحيل الفاتورة"}</button>
          </div>
        </div>
      </div>

      {(() => {
        const withPay = list.map((inv) => {
          const paid = invoicePaidAmount(receipts, inv.id);
          const payStatus = paid >= inv.grandTotal - 0.5 ? "paid" : paid > 0 ? "partial" : "unpaid";
          return { ...inv, paid, payStatus };
        });
        const filtered = withPay.filter((inv) => {
          const c = customers.find((x) => x.id === inv.customerId);
          if (searchText && !(inv.invoiceNumber.includes(searchText) || (c?.name || "").includes(searchText))) return false;
          if (statusFilter !== "all" && (inv.status || "posted") !== statusFilter) return false;
          if (paymentFilter !== "all" && inv.payStatus !== paymentFilter) return false;
          if (dateFrom && inv.date < dateFrom) return false;
          if (dateTo && inv.date > dateTo) return false;
          return true;
        });
        const postedCount = withPay.filter((i) => (i.status || "posted") !== "draft").length;
        const draftCount = withPay.length - postedCount;
        const paidCount = withPay.filter((i) => i.payStatus === "paid").length;
        const partialCount = withPay.filter((i) => i.payStatus === "partial").length;
        const unpaidCount = withPay.filter((i) => i.payStatus === "unpaid").length;
        const standardTotal = withPay.filter((i) => i.invoiceType === "standard").reduce((s, i) => s + i.grandTotal, 0);
        const simplifiedTotal = withPay.filter((i) => i.invoiceType === "simplified").reduce((s, i) => s + i.grandTotal, 0);

        return (
          <>
            <div className="analytics-row">
              <MiniDonut
                title="توزيع الفواتير حسب حالة الترحيل"
                segments={[
                  { label: "مرحّلة", value: postedCount, color: "#2F5D5A" },
                  { label: "مسودة", value: draftCount, color: "#B98B4E" },
                ]}
              />
              <MiniBarChart
                title="عدد الفواتير حسب حالة السداد"
                bars={[
                  { label: "مسددة", value: paidCount, color: "#2F5D5A" },
                  { label: "جزئياً", value: partialCount, color: "#B98B4E" },
                  { label: "غير مسددة", value: unpaidCount, color: "#A8432B" },
                ]}
                valueFormatter={(v) => v}
              />
              <MiniBarChart
                title="إجمالي القيمة حسب نوع الفاتورة"
                bars={[
                  { label: "قياسية (B2B)", value: standardTotal, color: "#3E6B8A" },
                  { label: "مبسّطة (B2C)", value: simplifiedTotal, color: "#8A5A3E" },
                ]}
              />
            </div>

            <div className="panel">
              <div className="filter-bar">
                <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="بحث برقم الفاتورة أو اسم العميل" />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">كل حالات الترحيل</option>
                  <option value="posted">مرحّلة</option>
                  <option value="draft">مسودة</option>
                </select>
                <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
                  <option value="all">كل حالات السداد</option>
                  <option value="paid">مسددة</option>
                  <option value="partial">مسددة جزئياً</option>
                  <option value="unpaid">غير مسددة</option>
                </select>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="من تاريخ" />
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="إلى تاريخ" />
              </div>

              <div className="invoices-table-wrap">
                <table className="invoices-table">
                  <thead>
                    <tr>
                      <th>الفاتورة</th><th>العميل</th><th>النوع</th><th>التاريخ</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>الترحيل</th><th>السداد</th><th>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice().reverse().map((inv) => {
                      const c = customers.find((x) => x.id === inv.customerId);
                      const posted = inv.status !== "draft";
                      const remaining = inv.grandTotal - inv.paid;
                      const payLabel = inv.payStatus === "paid" ? "مسددة" : inv.payStatus === "partial" ? "جزئياً" : "غير مسددة";
                      return (
                        <tr key={inv.id}>
                          <td>{inv.invoiceNumber}</td>
                          <td>{c?.name}</td>
                          <td>{inv.invoiceType === "standard" ? "قياسية" : "مبسّطة"}</td>
                          <td>{inv.date}</td>
                          <td className="num">{fmt(inv.grandTotal)}</td>
                          <td className="num">{fmt(inv.paid)}</td>
                          <td className="num strong">{fmt(remaining)}</td>
                          <td><span className={"status-pill " + (posted ? "pill-posted" : "pill-draft")}>{posted ? "مرحّلة" : "مسودة"}</span></td>
                          <td><span className={"status-pill " + (inv.payStatus === "paid" ? "pill-paid" : inv.payStatus === "partial" ? "pill-partial" : "pill-unpaid")}>{payLabel}</span></td>
                          <td>
                            <TxIconBar
                              onView={() => setPreviewInvoice(inv)}
                              onPrint={() => { setPreviewInvoice(inv); setTimeout(() => printWithOrientation(false), 200); }}
                              onExcel={() => exportInvoiceCsv(inv)}
                              onEdit={!posted ? () => startEdit(inv) : undefined}
                              onDelete={!posted ? () => deleteInvoice(inv) : undefined}
                              onUnpost={() => setUnpostTarget(inv)}
                              posted={posted}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && <p className="empty">لا توجد فواتير مطابقة لهذا البحث.</p>}
              </div>
            </div>
          </>
        );
      })()}

      {unpostTarget && (
        <UnpostConfirm unlockPin={unlockPin} onCancel={() => setUnpostTarget(null)} onConfirm={() => unpostInvoice(unpostTarget)} />
      )}

      <ExcelImportPanel
        title="فواتير المبيعات"
        exampleRows={[{ "رقم مرجعي": "REF1", "العميل": "اسم العميل بالضبط كما هو مسجّل", "التاريخ": "2026-07-20", "الحساب": SALES_REVENUE_ACCOUNTS[0], "الوصف": "وصف الصنف", "الكمية": 1, "سعر الوحدة": 115, "خصم %": 0, "شامل الضريبة؟": "نعم" }]}
        onImportRows={(rows) => {
          const groups = {};
          rows.forEach((r) => {
            const ref = r["رقم مرجعي"] || "بدون رقم";
            groups[ref] = groups[ref] || [];
            groups[ref].push(r);
          });
          let created = 0, skipped = 0;
          Object.entries(groups).forEach(([ref, rrows]) => {
            const custName = rrows[0]["العميل"];
            const cust = customers.find((c) => c.name === custName);
            if (!cust) { skipped += rrows.length; return; }
            const rowDate = String(rrows[0]["التاريخ"]);
            const cLines = rrows.map((r) => {
              const base = { account: r["الحساب"] || SALES_REVENUE_ACCOUNTS[0], description: r["الوصف"] || "", quantity: Number(r["الكمية"] || 0), unitPrice: Number(r["سعر الوحدة"] || 0), discountPct: Number(r["خصم %"] || 0), priceIncludesVat: String(r["شامل الضريبة؟"] || "نعم").trim() === "نعم" };
              return { ...base, ...computeInvoiceLine(base) };
            });
            const subtotal = cLines.reduce((s, l) => s + l.subtotal, 0);
            const vatT = cLines.reduce((s, l) => s + l.vat, 0);
            const grand = subtotal + vatT;
            const invoiceNumber = nextDocNumber(invoices, "INV", "invoiceNumber");
            const { jLines } = postInvoiceLines(cust, rowDate, cLines, invoiceNumber);
            const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
            setEntries((prev) => [...prev, { id: entryId, company: cust.company, date: rowDate, memo: `فاتورة مبيعات ${invoiceNumber} — ${cust.name} (استيراد)`, lines: jLines }]);
            const qrPayload = buildZatcaQrPayload(COMPANIES.find((c) => c.id === cust.company)?.name || "", COMPANIES.find((c) => c.id === cust.company)?.vatNumber || "", `${rowDate}T12:00:00`, grand, vatT);
            setInvoices((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((i) => i.id)) + 1 : 1, invoiceNumber, company: cust.company, customerId: cust.id, date: rowDate, invoiceType: invoiceTypeForCustomer(cust), lines: cLines, subtotal, vatTotal: vatT, grandTotal: grand, journalEntryId: entryId, qrPayload, status: "posted" }]);
            created++;
          });
          return `تم إنشاء ${created} فاتورة${skipped ? `، وتجاهل ${skipped} صف (عميل غير موجود بنفس الاسم بالضبط)` : ""}.`;
        }}
      />

      {previewInvoice && (() => {
        const c = customers.find((x) => x.id === previewInvoice.customerId);
        const company = COMPANIES.find((x) => x.id === previewInvoice.company);
        return (
          <PrintShell
            subtitle={previewInvoice.invoiceType === "standard" ? "فاتورة ضريبية قياسية" : "فاتورة ضريبية مبسّطة"}
            company={company}
            refNode={<>
              <div>رقم الفاتورة: <strong>{previewInvoice.invoiceNumber}</strong></div>
              <div>التاريخ: <strong>{previewInvoice.date}</strong></div>
            </>}
            onClose={() => setPreviewInvoice(null)}
          >
            <div className="voucher-meta">
              <div><span>البائع</span><strong>{company?.name}</strong></div>
              <div><span>الرقم الضريبي للبائع</span><strong>{company?.vatNumber || "لم يُدخل بعد"}</strong></div>
              <div><span>العميل</span><strong>{c?.name}</strong></div>
              <div><span>الرقم الضريبي للعميل</span><strong>{c?.vatNumber || "غير مسجّل (فرد)"}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>خصم %</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {previewInvoice.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description || l.account}</td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{fmt2(l.unitPrice)}</td>
                    <td className="num">{l.discountPct}٪</td>
                    <td className="num">{fmt(l.subtotal)}</td>
                    <td className="num">{fmt(l.vat)}</td>
                    <td className="num strong">{fmt(l.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td className="foot-label" colSpan={4}>الإجمالي</td><td className="num strong">{fmt(previewInvoice.subtotal)}</td><td className="num strong">{fmt(previewInvoice.vatTotal)}</td><td className="num strong">{fmt(previewInvoice.grandTotal)}</td></tr>
              </tfoot>
            </table>
            <div className="qr-box">
              <div className="qr-box-label">رمز الاستجابة السريعة (QR) — وفق معيار زاتكا</div>
              <QrImage payload={previewInvoice.qrPayload} />
              <details className="qr-details">
                <summary>عرض حمولة البيانات المشفّرة (Base64 TLV)</summary>
                <div className="qr-box-payload">{previewInvoice.qrPayload}</div>
              </details>
            </div>
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المبيعات: مردودات المبيعات ============ */

export function SalesReturnsModule({ customers, invoices, returns, setReturns, entries, setEntries, companyId }) {
  const companyCustomers = companyId === "all" ? customers : customers.filter((c) => c.company === companyId);
  const [customerId, setCustomerId] = useState(companyCustomers[0]?.id || "");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState("");
  const [date, setDate] = useState("2026-07-20");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("account");
  const [lines, setLines] = useState([emptyInvoiceLine()]);
  const [previewReturn, setPreviewReturn] = useState(null);

  const customer = customers.find((c) => c.id === customerId);
  const customerInvoices = invoices.filter((i) => i.customerId === customerId);
  const list = returns.filter((r) => companyCustomers.some((c) => c.id === r.customerId));

  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;

  const loadFromInvoice = (invId) => {
    setRelatedInvoiceId(invId);
    const inv = invoices.find((i) => i.id === Number(invId));
    if (inv) setLines(inv.lines.map((l) => ({ account: l.account, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct })));
  };

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyInvoiceLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const saveReturn = () => {
    if (!customer || grandTotal <= 0) return;
    const returnNumber = nextDocNumber(returns, "RET", "returnNumber");
    const byAccount = {};
    computedLines.forEach((l) => { byAccount[l.account] = (byAccount[l.account] || 0) + l.subtotal; });
    const jLines = Object.entries(byAccount).map(([account, amount]) => ({
      account, costCenter: "", department: "المبيعات والتسويق", debit: amount, credit: 0, customerId: customer.id,
    }));
    jLines.push({ account: "ضريبة القيمة المضافة - مخرجات", costCenter: "", department: "المالية والحسابات", debit: vatTotal, credit: 0, customerId: customer.id });
    const creditAccount = refundMethod === "cash" ? "النقدية بالصندوق" : refundMethod === "bank" ? "البنك الأهلي - حساب تشغيلي" : "ذمم مدينة";
    jLines.push({ account: creditAccount, costCenter: "", department: "المالية والحسابات", debit: 0, credit: grandTotal, customerId: customer.id });

    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: customer.company, date, memo: `مردود مبيعات ${returnNumber} — ${customer.name}`, lines: jLines }]);

    setReturns((prev) => [
      ...prev,
      {
        id: prev.length ? Math.max(...prev.map((r) => r.id)) + 1 : 1,
        returnNumber, company: customer.company, customerId: customer.id, date,
        relatedInvoiceId: relatedInvoiceId || null, reason, refundMethod,
        lines: computedLines.map(({ account, description, quantity, unitPrice, discountPct, subtotal: st, vat, total }) => ({ account, description, quantity: Number(quantity), unitPrice: Number(unitPrice), discountPct: Number(discountPct), subtotal: st, vat, total })),
        subtotal, vatTotal, grandTotal, journalEntryId: entryId,
      },
    ]);
    setLines([emptyInvoiceLine()]); setReason(""); setRelatedInvoiceId("");
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>العميل
            <select value={customerId} onChange={(e) => { setCustomerId(Number(e.target.value)); setRelatedInvoiceId(""); }}>
              {companyCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>الفاتورة الأصلية (اختياري)
            <select value={relatedInvoiceId} onChange={(e) => loadFromInvoice(e.target.value)}>
              <option value="">— بدون ربط —</option>
              {customerInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber} ({fmt(i.grandTotal)} ر.س)</option>)}
            </select>
          </label>
          <label>تاريخ المردود<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>طريقة الرد
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="account">خصم من رصيد العميل (ذمم)</option>
              <option value="cash">رد نقدي</option>
              <option value="bank">رد بنكي</option>
            </select>
          </label>
          <label className="memo-field">سبب المردود<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: بضاعة تالفة" /></label>
        </div>

        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الحساب</th><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>خصم %</th><th>الإجمالي شامل الضريبة</th><th></th></tr></thead>
            <tbody>
              {computedLines.map((l, idx) => (
                <tr key={idx}>
                  <td>
                    <select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}>
                      {SALES_REVENUE_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={l.description} onChange={(e) => updateLine(idx, "description", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, "quantity", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, "unitPrice", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.discountPct} onChange={(e) => updateLine(idx, "discountPct", e.target.value)} /></td>
                  <td className="num">{fmt2(l.total)}</td>
                  <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="preview-box">
          <div className="preview-row"><span>قبل الضريبة</span><strong>{fmt(subtotal)} ر.س</strong></div>
          <div className="preview-row"><span>ضريبة القيمة المضافة</span><strong>{fmt(vatTotal)} ر.س</strong></div>
          <div className="preview-row net-row"><span>إجمالي المردود</span><strong>{fmt(grandTotal)} ر.س</strong></div>
        </div>

        <div className="journal-actions">
          <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
          <button className="btn-primary" onClick={saveReturn} disabled={!customer || grandTotal <= 0}>حفظ وترحيل المردود</button>
        </div>
      </div>

      <div className="entries-feed">
        {list.slice().reverse().map((r) => {
          const c = customers.find((x) => x.id === r.customerId);
          return (
            <div className="panel entry-card" key={r.id}>
              <div className="entry-card-head">
                <div>
                  <span className="entry-memo">{r.returnNumber} — {c?.name}</span>
                  <span className="entry-meta">{r.date} {r.reason ? `· ${r.reason}` : ""}</span>
                </div>
                <span className="entry-total">-{fmt(r.grandTotal)} ر.س</span>
              </div>
              <div className="entry-card-actions">
                <button className="btn-ghost" onClick={() => setPreviewReturn(r)}>معاينة / طباعة</button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا توجد مردودات مسجّلة بعد.</p>}
      </div>

      {previewReturn && (() => {
        const c = customers.find((x) => x.id === previewReturn.customerId);
        const company = COMPANIES.find((x) => x.id === previewReturn.company);
        return (
          <PrintShell
            subtitle="إشعار دائن — مردود مبيعات"
            company={company}
            refNode={<>
              <div>رقم المردود: <strong>{previewReturn.returnNumber}</strong></div>
              <div>التاريخ: <strong>{previewReturn.date}</strong></div>
            </>}
            onClose={() => setPreviewReturn(null)}
          >
            <div className="voucher-meta">
              <div><span>العميل</span><strong>{c?.name}</strong></div>
              <div><span>السبب</span><strong>{previewReturn.reason || "—"}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الوصف</th><th>الكمية</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {previewReturn.lines.map((l, i) => (
                  <tr key={i}><td>{l.description || l.account}</td><td className="num">{l.quantity}</td><td className="num">{fmt(l.subtotal)}</td><td className="num">{fmt(l.vat)}</td><td className="num strong">{fmt(l.total)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td className="foot-label" colSpan={4}>الإجمالي</td><td className="num strong">{fmt(previewReturn.grandTotal)}</td></tr>
              </tfoot>
            </table>
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المبيعات: التقارير ============ */

export function partyLedgerRows(entries, account, tagField, tagValue) {
  const rows = [];
  entries.forEach((e) => e.lines.forEach((l) => {
    if (l.account === account && l[tagField] === tagValue) {
      rows.push({ date: e.date, memo: e.memo, debit: Number(l.debit || 0), credit: Number(l.credit || 0) });
    }
  }));
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  return rows.map((r) => { running += r.debit - r.credit; return { ...r, balance: running }; });
}
export function customerLedgerRows(entries, customerId) { return partyLedgerRows(entries, "ذمم مدينة", "customerId", customerId); }
export function supplierLedgerRows(entries, supplierId) { return partyLedgerRows(entries, "ذمم دائنة - موردين", "supplierId", supplierId); }

export function agingBuckets(docs, outstandingBalance, todayStr, dateField, totalField) {
  const sorted = docs.slice().sort((a, b) => new Date(a[dateField]) - new Date(b[dateField]));
  let remaining = outstandingBalance;
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const doc of sorted) {
    if (remaining <= 0.5) break;
    const alloc = Math.min(doc[totalField], remaining);
    remaining -= alloc;
    const days = Math.floor((new Date(todayStr) - new Date(doc[dateField])) / 86400000);
    if (days <= 30) buckets.current += alloc;
    else if (days <= 60) buckets.d30 += alloc;
    else if (days <= 90) buckets.d60 += alloc;
    else buckets.d90 += alloc;
  }
  return buckets;
}

export const SALES_REPORT_TABS = [
  { id: "byCustomer", label: "حسب العميل" },
  { id: "monthly", label: "الاتجاه الشهري" },
  { id: "aging", label: "أعمار الذمم" },
  { id: "vat", label: "ملخص الضريبة" },
];

export function SalesReportsModule({ customers, invoices, returns, entries, companyId }) {
  const [tab, setTab] = useState("byCustomer");
  const companyCustomers = companyId === "all" ? customers : customers.filter((c) => c.company === companyId);
  const companyInvoices = invoices.filter((i) => companyCustomers.some((c) => c.id === i.customerId));
  const companyReturns = returns.filter((r) => companyCustomers.some((c) => c.id === r.customerId));

  return (
    <div>
      <div className="report-tabs">
        {SALES_REPORT_TABS.map((t) => (
          <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === "byCustomer" && (
        <div className="panel">
          <h3>المبيعات حسب العميل</h3>
          <table className="ledger-table">
            <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>إجمالي الفواتير</th><th>إجمالي المردودات</th><th>صافي المبيعات</th><th>الرصيد المستحق</th></tr></thead>
            <tbody>
              {companyCustomers.map((c) => {
                const custInv = companyInvoices.filter((i) => i.customerId === c.id);
                const custRet = companyReturns.filter((r) => r.customerId === c.id);
                const invTotal = custInv.reduce((s, i) => s + i.grandTotal, 0);
                const retTotal = custRet.reduce((s, r) => s + r.grandTotal, 0);
                const balance = customerAccountBalance(entries, c.id);
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">{custInv.length}</td>
                    <td className="num">{fmt(invTotal)}</td>
                    <td className="num">{fmt(retTotal)}</td>
                    <td className="num strong">{fmt(invTotal - retTotal)}</td>
                    <td className="num">{fmt(balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {companyCustomers.length === 0 && <p className="empty">لا يوجد عملاء بعد.</p>}
        </div>
      )}

      {tab === "monthly" && (() => {
        const byMonth = {};
        companyInvoices.forEach((i) => {
          const m = i.date.slice(0, 7);
          byMonth[m] = byMonth[m] || { count: 0, subtotal: 0, vat: 0, total: 0 };
          byMonth[m].count += 1; byMonth[m].subtotal += i.subtotal; byMonth[m].vat += i.vatTotal; byMonth[m].total += i.grandTotal;
        });
        const months = Object.keys(byMonth).sort();
        return (
          <div className="panel">
            <h3>اتجاه المبيعات الشهري</h3>
            <table className="ledger-table">
              <thead><tr><th>الشهر</th><th>عدد الفواتير</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m}>
                    <td>{monthLabel(m)}</td>
                    <td className="num">{byMonth[m].count}</td>
                    <td className="num">{fmt(byMonth[m].subtotal)}</td>
                    <td className="num">{fmt(byMonth[m].vat)}</td>
                    <td className="num strong">{fmt(byMonth[m].total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {months.length === 0 && <p className="empty">لا توجد فواتير مسجّلة بعد.</p>}
          </div>
        );
      })()}

      {tab === "aging" && (
        <div className="panel">
          <h3>أعمار الذمم المدينة (حتى 2026-07-20)</h3>
          <table className="ledger-table">
            <thead><tr><th>العميل</th><th>0-30 يوم</th><th>31-60 يوم</th><th>61-90 يوم</th><th>أكثر من 90 يوم</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {companyCustomers.map((c) => {
                const balance = customerAccountBalance(entries, c.id);
                if (balance <= 0.5) return null;
                const custInv = companyInvoices.filter((i) => i.customerId === c.id);
                const b = agingBuckets(custInv, balance, "2026-07-20", "date", "grandTotal");
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">{fmt(b.current)}</td>
                    <td className="num">{fmt(b.d30)}</td>
                    <td className="num">{fmt(b.d60)}</td>
                    <td className="num balance-bad">{fmt(b.d90)}</td>
                    <td className="num strong">{fmt(balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {companyCustomers.every((c) => customerAccountBalance(entries, c.id) <= 0.5) && <p className="empty">لا توجد أرصدة مستحقة حالياً.</p>}
        </div>
      )}

      {tab === "vat" && (() => {
        const outputVatInvoices = companyInvoices.reduce((s, i) => s + i.vatTotal, 0);
        const outputVatReturns = companyReturns.reduce((s, r) => s + r.vatTotal, 0);
        const netVat = outputVatInvoices - outputVatReturns;
        return (
          <>
            <div className="gauge-row gauge-row-3">
              <Gauge label="ضريبة مخرجات الفواتير" value={outputVatInvoices} max={100000} unit="ر.س" tone="#2F5D5A" />
              <Gauge label="ضريبة مخرجات المردودات" value={outputVatReturns} max={30000} unit="ر.س" tone="#A8432B" />
              <Gauge label="صافي ضريبة المبيعات" value={Math.max(netVat, 0)} max={100000} unit="ر.س" tone="#B98B4E" />
            </div>
            <div className="panel">
              <table className="ledger-table">
                <tbody>
                  <tr><td>إجمالي ضريبة المخرجات على الفواتير</td><td className="num">{fmt(outputVatInvoices)} ر.س</td></tr>
                  <tr><td>إجمالي ضريبة المخرجات على المردودات (تُخصم)</td><td className="num">-{fmt(outputVatReturns)} ر.س</td></tr>
                  <tr className="net-row"><td className="strong">صافي ضريبة المبيعات المستحقة</td><td className="num strong">{fmt(netVat)} ر.س</td></tr>
                </tbody>
              </table>
            </div>
          </>
        );
      })()}
    </div>
  );
}

/* ============ المبيعات: الإطار العام للوحدة ============ */

/* ============ المبيعات: عروض الأسعار ============ */

export function QuotationsModule({ customers, quotes, setQuotes, invoices, setInvoices, entries, setEntries, companyId }) {
  const companyCustomers = companyId === "all" ? customers : customers.filter((c) => c.company === companyId);
  const [customerId, setCustomerId] = useState(companyCustomers[0]?.id || "");
  const [date, setDate] = useState("2026-07-20");
  const [validUntil, setValidUntil] = useState("2026-08-19");
  const [lines, setLines] = useState([emptyInvoiceLine()]);
  const [previewQuote, setPreviewQuote] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const list = quotes.filter((q) => companyCustomers.some((c) => c.id === q.customerId));
  const customer = customers.find((c) => c.id === customerId);
  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyInvoiceLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const resetForm = () => { setEditingId(null); setLines([emptyInvoiceLine()]); };

  const saveQuote = () => {
    if (!customer || grandTotal <= 0) return;
    const cleanLines = computedLines.map(({ account, description, quantity, unitPrice, discountPct, priceIncludesVat, subtotal: st, vat, total }) => ({ account, description, quantity: Number(quantity), unitPrice: Number(unitPrice), discountPct: Number(discountPct), priceIncludesVat, subtotal: st, vat, total }));
    if (editingId) {
      setQuotes((prev) => prev.map((q) => (q.id === editingId ? { ...q, customerId: customer.id, date, validUntil, lines: cleanLines, subtotal, vatTotal, grandTotal } : q)));
    } else {
      const quoteNumber = nextDocNumber(quotes, "QUO", "quoteNumber");
      setQuotes((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((q) => q.id)) + 1 : 1, quoteNumber, company: customer.company, customerId: customer.id, date, validUntil, lines: cleanLines, subtotal, vatTotal, grandTotal, status: "draft", convertedInvoiceId: null }]);
    }
    resetForm();
  };

  const startEdit = (q) => {
    if (q.status === "converted") return;
    setEditingId(q.id); setCustomerId(q.customerId); setDate(q.date); setValidUntil(q.validUntil);
    setLines(q.lines.map((l) => ({ ...l }))); setPreviewQuote(null);
  };
  const deleteQuote = (q) => {
    if (q.status === "converted") return;
    if (!window.confirm(`حذف عرض السعر ${q.quoteNumber}؟`)) return;
    setQuotes((prev) => prev.filter((x) => x.id !== q.id));
  };

  const convertToInvoice = (q) => {
    if (q.status === "converted") return;
    const c = customers.find((x) => x.id === q.customerId);
    if (!c) return;
    const invoiceNumber = nextDocNumber(invoices, "INV", "invoiceNumber");
    const byAccount = {};
    q.lines.forEach((l) => { byAccount[l.account] = (byAccount[l.account] || 0) + l.subtotal; });
    const jLines = Object.entries(byAccount).map(([account, amount]) => ({ account, costCenter: "", department: "المبيعات والتسويق", debit: 0, credit: amount, customerId: c.id }));
    jLines.push({ account: "ضريبة القيمة المضافة - مخرجات", costCenter: "", department: "المالية والحسابات", debit: 0, credit: q.vatTotal, customerId: c.id });
    jLines.push({ account: "ذمم مدينة", costCenter: "", department: "المالية والحسابات", debit: q.grandTotal, credit: 0, customerId: c.id });
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    const today = "2026-07-20";
    setEntries((prev) => [...prev, { id: entryId, company: c.company, date: today, memo: `فاتورة مبيعات ${invoiceNumber} — ${c.name} (من عرض سعر ${q.quoteNumber})`, lines: jLines }]);
    const invType = invoiceTypeForCustomer(c);
    const qrPayload = buildZatcaQrPayload(COMPANIES.find((x) => x.id === c.company)?.name || "", COMPANIES.find((x) => x.id === c.company)?.vatNumber || "", `${today}T12:00:00`, q.grandTotal, q.vatTotal);
    const newInvoiceId = invoices.length ? Math.max(...invoices.map((i) => i.id)) + 1 : 1;
    setInvoices((prev) => [...prev, { id: newInvoiceId, invoiceNumber, company: c.company, customerId: c.id, date: today, invoiceType: invType, lines: q.lines, subtotal: q.subtotal, vatTotal: q.vatTotal, grandTotal: q.grandTotal, journalEntryId: entryId, qrPayload, status: "posted" }]);
    setQuotes((prev) => prev.map((x) => (x.id === q.id ? { ...x, status: "converted", convertedInvoiceId: newInvoiceId } : x)));
  };

  const exportQuoteCsv = (q) => {
    const c = customers.find((x) => x.id === q.customerId);
    const rows = [["الوصف", "الكمية", "سعر الوحدة", "خصم %", "قبل الضريبة", "الضريبة", "الإجمالي"]];
    q.lines.forEach((l) => rows.push([l.description || l.account, l.quantity, l.unitPrice, l.discountPct, l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2)]));
    downloadCsv(`${q.quoteNumber}_${c?.name || ""}.csv`, rows);
  };

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل عرض السعر {quotes.find((q) => q.id === editingId)?.quoteNumber}</div>}
        <div className="form-grid header-grid">
          <label>العميل<select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>{companyCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>تاريخ العرض<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>صالح حتى<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
        </div>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الحساب</th><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>شامل الضريبة؟</th><th>خصم %</th><th>الإجمالي</th><th></th></tr></thead>
            <tbody>
              {computedLines.map((l, idx) => (
                <tr key={idx}>
                  <td><select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}>{SALES_REVENUE_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
                  <td><input type="text" value={l.description} onChange={(e) => updateLine(idx, "description", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, "quantity", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, "unitPrice", e.target.value)} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={l.priceIncludesVat} onChange={(e) => updateLine(idx, "priceIncludesVat", e.target.checked)} /></td>
                  <td><input type="number" className="amount-input" value={l.discountPct} onChange={(e) => updateLine(idx, "discountPct", e.target.value)} /></td>
                  <td className="num">{fmt2(l.total)}</td>
                  <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="preview-box">
          <div className="preview-row"><span>قبل الضريبة</span><strong>{fmt(subtotal)} ر.س</strong></div>
          <div className="preview-row"><span>الضريبة</span><strong>{fmt(vatTotal)} ر.س</strong></div>
          <div className="preview-row net-row"><span>الإجمالي</span><strong>{fmt(grandTotal)} ر.س</strong></div>
        </div>
        <div className="journal-actions">
          <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
          <div className="form-btn-group">
            {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء</button>}
            <button className="btn-primary" onClick={saveQuote} disabled={!customer || grandTotal <= 0}>{editingId ? "حفظ التعديلات" : "حفظ عرض السعر"}</button>
          </div>
        </div>
      </div>

      <div className="entries-feed">
        {list.slice().reverse().map((q) => {
          const c = customers.find((x) => x.id === q.customerId);
          return (
            <div className="panel entry-card" key={q.id}>
              <div className="entry-card-head">
                <div>
                  <span className="entry-memo">{q.quoteNumber} — {c?.name}</span>
                  <span className="entry-meta">{q.date} · صالح حتى {q.validUntil} · {q.status === "converted" ? "تم التحويل لفاتورة" : "قيد المراجعة"}</span>
                </div>
                <span className="entry-total">{fmt(q.grandTotal)} ر.س</span>
              </div>
              <div className="entry-card-actions">
                {q.status !== "converted" && <button className="btn-primary" onClick={() => convertToInvoice(q)}>تحويل لفاتورة</button>}
              </div>
              <TxIconBar
                onView={() => setPreviewQuote(q)}
                onPrint={() => { setPreviewQuote(q); setTimeout(() => printWithOrientation(false), 200); }}
                onExcel={() => exportQuoteCsv(q)}
                onEdit={q.status !== "converted" ? () => startEdit(q) : undefined}
                onDelete={q.status !== "converted" ? () => deleteQuote(q) : undefined}
              />
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا توجد عروض أسعار مسجّلة بعد.</p>}
      </div>

      {previewQuote && (() => {
        const c = customers.find((x) => x.id === previewQuote.customerId);
        const company = COMPANIES.find((x) => x.id === previewQuote.company);
        return (
          <PrintShell subtitle="عرض سعر" company={company} refNode={<><div>رقم العرض: <strong>{previewQuote.quoteNumber}</strong></div><div>صالح حتى: <strong>{previewQuote.validUntil}</strong></div></>} onClose={() => setPreviewQuote(null)}>
            <div className="voucher-meta"><div><span>العميل</span><strong>{c?.name}</strong></div><div><span>تاريخ العرض</span><strong>{previewQuote.date}</strong></div></div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>{previewQuote.lines.map((l, i) => (<tr key={i}><td>{l.description || l.account}</td><td className="num">{l.quantity}</td><td className="num">{fmt2(l.unitPrice)}</td><td className="num">{fmt(l.subtotal)}</td><td className="num">{fmt(l.vat)}</td><td className="num strong">{fmt(l.total)}</td></tr>))}</tbody>
              <tfoot><tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(previewQuote.subtotal)}</td><td className="num strong">{fmt(previewQuote.vatTotal)}</td><td className="num strong">{fmt(previewQuote.grandTotal)}</td></tr></tfoot>
            </table>
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المبيعات: سندات القبض ============ */

export function ReceiptsModule({ customers, invoices, receipts, setReceipts, entries, setEntries, companyId, unlockPin }) {
  const companyCustomers = companyId === "all" ? customers : customers.filter((c) => c.company === companyId);
  const [customerId, setCustomerId] = useState(companyCustomers[0]?.id || "");
  const [date, setDate] = useState("2026-07-20");
  const [method, setMethod] = useState("cash");
  const [allocations, setAllocations] = useState({});
  const [previewReceipt, setPreviewReceipt] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);

  const customerInvoices = invoices.filter((i) => i.customerId === customerId).map((i) => ({ ...i, paid: invoicePaidAmount(receipts, i.id) })).filter((i) => i.paid < i.grandTotal - 0.5);
  const list = receipts.filter((r) => companyCustomers.some((c) => c.id === r.customerId));

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + Number(v || 0), 0);

  const setAlloc = (invId, value) => setAllocations((prev) => ({ ...prev, [invId]: value }));
  const autoAllocate = () => {
    const na = {};
    // FIFO by date
    const sorted = customerInvoices.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    let remaining = sorted.reduce((s, i) => s + (i.grandTotal - i.paid), 0);
    sorted.forEach((i) => {
      const due = i.grandTotal - i.paid;
      const alloc = Math.min(due, remaining);
      if (alloc > 0) na[i.id] = alloc.toFixed(2);
      remaining -= alloc;
    });
    setAllocations(na);
  };

  const saveReceipt = () => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer || totalAllocated <= 0) return;
    const receiptNumber = nextDocNumber(receipts, "REC", "receiptNumber");
    const creditAccount = method === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي";
    const jLines = [
      { account: creditAccount, costCenter: "", department: "المالية والحسابات", debit: totalAllocated, credit: 0, customerId: customer.id },
      { account: "ذمم مدينة", costCenter: "", department: "المالية والحسابات", debit: 0, credit: totalAllocated, customerId: customer.id },
    ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: customer.company, date, memo: `سند قبض ${receiptNumber} — ${customer.name}`, lines: jLines }]);

    const allocList = Object.entries(allocations).filter(([, v]) => Number(v) > 0).map(([invoiceId, v]) => ({ invoiceId: Number(invoiceId), amount: Number(v) }));
    setReceipts((prev) => [...prev, {
      id: prev.length ? Math.max(...prev.map((r) => r.id)) + 1 : 1, receiptNumber, company: customer.company, customerId: customer.id,
      date, method, totalAmount: totalAllocated, allocations: allocList, journalEntryId: entryId, status: "posted",
    }]);
    setAllocations({});
  };

  const deleteReceipt = (r) => {
    if (r.status === "posted") return;
    if (!window.confirm(`حذف سند القبض ${r.receiptNumber}؟`)) return;
    setReceipts((prev) => prev.filter((x) => x.id !== r.id));
  };
  const unpostReceipt = (r) => {
    setEntries((prev) => prev.filter((e) => e.id !== r.journalEntryId));
    setReceipts((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "draft", journalEntryId: null } : x)));
    setUnpostTarget(null);
  };
  const repostReceipt = (r) => {
    const customer = customers.find((c) => c.id === r.customerId);
    const creditAccount = r.method === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي";
    const jLines = [
      { account: creditAccount, costCenter: "", department: "المالية والحسابات", debit: r.totalAmount, credit: 0, customerId: r.customerId },
      { account: "ذمم مدينة", costCenter: "", department: "المالية والحسابات", debit: 0, credit: r.totalAmount, customerId: r.customerId },
    ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: r.company, date: r.date, memo: `سند قبض ${r.receiptNumber} — ${customer?.name}`, lines: jLines }]);
    setReceipts((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "posted", journalEntryId: entryId } : x)));
  };
  const exportReceiptCsv = (r) => {
    const c = customers.find((x) => x.id === r.customerId);
    const rows = [["الفاتورة", "المبلغ المخصص"]];
    r.allocations.forEach((a) => { const inv = invoices.find((i) => i.id === a.invoiceId); rows.push([inv?.invoiceNumber || a.invoiceId, a.amount.toFixed(2)]); });
    downloadCsv(`${r.receiptNumber}_${c?.name || ""}.csv`, rows);
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>العميل<select value={customerId} onChange={(e) => { setCustomerId(Number(e.target.value)); setAllocations({}); }}>{companyCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>تاريخ السند<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>طريقة التحصيل<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">كاش</option><option value="bank">بنك</option></select></label>
        </div>

        <h3 className="sub-head">الفواتير المستحقة على هذا العميل</h3>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>المبلغ المخصص الآن</th></tr></thead>
            <tbody>
              {customerInvoices.map((inv) => {
                const due = inv.grandTotal - inv.paid;
                return (
                  <tr key={inv.id}>
                    <td>{inv.invoiceNumber}</td><td>{inv.date}</td>
                    <td className="num">{fmt(inv.grandTotal)}</td><td className="num">{fmt(inv.paid)}</td><td className="num strong">{fmt(due)}</td>
                    <td><input type="number" className="amount-input" value={allocations[inv.id] || ""} onChange={(e) => setAlloc(inv.id, e.target.value)} placeholder="0.00" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {customerInvoices.length === 0 && <p className="empty">لا توجد فواتير مستحقة على هذا العميل.</p>}

        <div className="journal-actions">
          <button className="btn-ghost" onClick={autoAllocate}>توزيع تلقائي (الأقدم أولاً)</button>
          <div className="preview-box" style={{ margin: 0 }}>
            <div className="preview-row net-row"><span>إجمالي السند</span><strong>{fmt(totalAllocated)} ر.س</strong></div>
          </div>
          <button className="btn-primary" onClick={saveReceipt} disabled={totalAllocated <= 0}>حفظ وترحيل سند القبض</button>
        </div>
      </div>

      <div className="entries-feed">
        {list.slice().reverse().map((r) => {
          const c = customers.find((x) => x.id === r.customerId);
          const posted = r.status !== "draft";
          return (
            <div className="panel entry-card" key={r.id}>
              <div className="entry-card-head">
                <div>
                  <span className="entry-memo">{r.receiptNumber} — {c?.name}</span>
                  <span className="entry-meta">{r.date} · {r.method === "cash" ? "كاش" : "بنك"}{!posted && " · مسودة"}</span>
                </div>
                <span className="entry-total">{fmt(r.totalAmount)} ر.س</span>
              </div>
              <TxIconBar
                onView={() => setPreviewReceipt(r)}
                onPrint={() => { setPreviewReceipt(r); setTimeout(() => printWithOrientation(false), 200); }}
                onExcel={() => exportReceiptCsv(r)}
                onDelete={!posted ? () => deleteReceipt(r) : undefined}
                onPost={!posted ? () => repostReceipt(r) : undefined}
                onUnpost={() => setUnpostTarget(r)}
                posted={posted}
              />
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا توجد سندات قبض مسجّلة بعد.</p>}
      </div>

      {unpostTarget && <UnpostConfirm unlockPin={unlockPin} onCancel={() => setUnpostTarget(null)} onConfirm={() => unpostReceipt(unpostTarget)} />}

      {previewReceipt && (() => {
        const c = customers.find((x) => x.id === previewReceipt.customerId);
        const company = COMPANIES.find((x) => x.id === previewReceipt.company);
        return (
          <PrintShell subtitle="سند قبض" company={company} refNode={<><div>رقم السند: <strong>{previewReceipt.receiptNumber}</strong></div><div>التاريخ: <strong>{previewReceipt.date}</strong></div></>} onClose={() => setPreviewReceipt(null)}>
            <div className="voucher-meta">
              <div><span>العميل</span><strong>{c?.name}</strong></div>
              <div><span>طريقة التحصيل</span><strong>{previewReceipt.method === "cash" ? "كاش" : "بنك"}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الفاتورة</th><th>المبلغ المخصص</th></tr></thead>
              <tbody>
                {previewReceipt.allocations.map((a, i) => {
                  const inv = invoices.find((x) => x.id === a.invoiceId);
                  return <tr key={i}><td>{inv?.invoiceNumber || "—"}</td><td className="num">{fmt(a.amount)}</td></tr>;
                })}
              </tbody>
              <tfoot><tr><td className="foot-label">الإجمالي</td><td className="num strong">{fmt(previewReceipt.totalAmount)}</td></tr></tfoot>
            </table>
          </PrintShell>
        );
      })()}
    </div>
  );
}

export const SALES_TABS = [
  { id: "customers", label: "العملاء" },
  { id: "quotes", label: "عروض الأسعار" },
  { id: "invoices", label: "فواتير المبيعات" },
  { id: "returns", label: "مردودات المبيعات" },
  { id: "receipts", label: "سندات القبض" },
  { id: "stations", label: "مبيعات المحطات" },
  { id: "reports", label: "التقارير" },
];

export function SalesModule({ customers, setCustomers, invoices, setInvoices, returns, setReturns, quotes, setQuotes, receipts, setReceipts, sales, setSales, entries, setEntries, companyId, tab, setTab, unlockPin }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">التجارة والمبيعات</span>
        <h2>المبيعات</h2>
      </div>
      <div className="report-tabs">
        {SALES_TABS.map((t) => (
          <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "customers" && <CustomerDirectory customers={customers} setCustomers={setCustomers} entries={entries} companyId={companyId} />}
      {tab === "quotes" && <QuotationsModule customers={customers} quotes={quotes} setQuotes={setQuotes} invoices={invoices} setInvoices={setInvoices} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "invoices" && <SalesInvoiceModule customers={customers} invoices={invoices} setInvoices={setInvoices} receipts={receipts} entries={entries} setEntries={setEntries} companyId={companyId} unlockPin={unlockPin} />}
      {tab === "returns" && <SalesReturnsModule customers={customers} invoices={invoices} returns={returns} setReturns={setReturns} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "receipts" && <ReceiptsModule customers={customers} invoices={invoices} receipts={receipts} setReceipts={setReceipts} entries={entries} setEntries={setEntries} companyId={companyId} unlockPin={unlockPin} />}
      {tab === "stations" && <StationsModule sales={sales} setSales={setSales} companyId={companyId} />}
      {tab === "reports" && <SalesReportsModule customers={customers} invoices={invoices} returns={returns} entries={entries} companyId={companyId} />}
    </div>
  );
}
