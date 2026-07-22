import React, { useState } from "react";
import { COMPANIES, PAYMENT_TERMS, PURCHASE_LINE_ACCOUNTS, emptySupplierForm, supplierAccountBalance, nextDocNumber, fmt, fmt2 } from "./constants";
import { Icon, TxIconBar, PrintShell, ExcelImportPanel, downloadCsv, printWithOrientation, MiniDonut, MiniBarChart, UnpostConfirm } from "./shared";
import { computeInvoiceLine, supplierLedgerRows, agingBuckets } from "./sales";

export function SupplierDirectory({ suppliers, setSuppliers, entries, companyId }) {
  const [form, setForm] = useState(emptySupplierForm(companyId));
  const [statementSupplier, setStatementSupplier] = useState(null);
  const list = companyId === "all" ? suppliers : suppliers.filter((s) => s.company === companyId);

  const addSupplier = () => {
    if (!form.name) return;
    setSuppliers((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((s) => s.id)) + 1 : 1, ...form }]);
    setForm(emptySupplierForm(companyId));
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>اسم المورد<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الشركة (جهة التعامل)
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
              {COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>الرقم الضريبي<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value.replace(/\D/g, "") })} placeholder="3xxxxxxxxxxxxx3" /></label>
          <label>رقم السجل التجاري<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></label>
          <label>الجوال<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>المدينة<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>شروط الدفع
            <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              {PAYMENT_TERMS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-primary" onClick={addSupplier}>حفظ بيانات المورد</button>
      </div>

      <div className="hr-grid">
        {list.map((s) => {
          const balance = supplierAccountBalance(entries, s.id);
          return (
            <div className="panel emp-card" key={s.id}>
              <div className="emp-card-head">
                <div><div className="emp-name">{s.name}</div><div className="emp-role">{s.city || "—"}</div></div>
                <span className="status-badge">{s.paymentTerms}</span>
              </div>
              <div className="emp-meta-grid">
                <div><span>الرقم الضريبي</span><strong>{s.vatNumber || "—"}</strong></div>
                <div><span>السجل التجاري</span><strong>{s.crNumber || "—"}</strong></div>
                <div><span>الجوال</span><strong>{s.phone || "—"}</strong></div>
                <div><span>المستحق له</span><strong className={balance > 0 ? "balance-bad" : ""}>{fmt(balance)} ر.س</strong></div>
              </div>
              <div className="entry-card-actions">
                <button className="btn-ghost" onClick={() => setStatementSupplier(s)}>كشف حساب</button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا يوجد موردون مسجّلون لهذا الكيان بعد.</p>}
      </div>

      {statementSupplier && (() => {
        const rows = supplierLedgerRows(entries, statementSupplier.id);
        const company = COMPANIES.find((c) => c.id === statementSupplier.company);
        return (
          <PrintShell subtitle="كشف حساب مورد" company={company} refNode={<div>تاريخ الكشف: <strong>2026-07-20</strong></div>} onClose={() => setStatementSupplier(null)}>
            <div className="voucher-meta">
              <div><span>اسم المورد</span><strong>{statementSupplier.name}</strong></div>
              <div><span>الرقم الضريبي</span><strong>{statementSupplier.vatNumber || "—"}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td><td>{r.memo}</td>
                    <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
                    <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
                    <td className="num strong">{fmt(-r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="empty">لا توجد حركات مسجّلة على هذا المورد.</p>}
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المشتريات: فواتير المشتريات ============ */

export function PurchaseInvoiceModule({ suppliers, invoices, setInvoices, entries, setEntries, companyId, unlockPin }) {
  const companySuppliers = companyId === "all" ? suppliers : suppliers.filter((s) => s.company === companyId);
  const [supplierId, setSupplierId] = useState(companySuppliers[0]?.id || "");
  const [date, setDate] = useState("2026-07-20");
  const [lines, setLines] = useState([{ account: PURCHASE_LINE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0 }]);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const list = invoices.filter((inv) => companySuppliers.some((s) => s.id === inv.supplierId));
  const supplier = suppliers.find((s) => s.id === supplierId);
  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, { account: PURCHASE_LINE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0 }]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const resetForm = () => { setEditingId(null); setLines([{ account: PURCHASE_LINE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0 }]); };

  const buildJLines = (supplier, computedLines, vatTotal, grandTotal) => {
    const byAccount = {};
    computedLines.forEach((l) => { byAccount[l.account] = (byAccount[l.account] || 0) + l.subtotal; });
    const jLines = Object.entries(byAccount).map(([account, amount]) => ({ account, costCenter: "", department: "المشتريات", debit: amount, credit: 0, supplierId: supplier.id }));
    jLines.push({ account: "ضريبة القيمة المضافة - مدخلات", costCenter: "", department: "المالية والحسابات", debit: vatTotal, credit: 0, supplierId: supplier.id });
    jLines.push({ account: "ذمم دائنة - موردين", costCenter: "", department: "المالية والحسابات", debit: 0, credit: grandTotal, supplierId: supplier.id });
    return jLines;
  };

  const saveInvoice = () => {
    if (!supplier || grandTotal <= 0) return;
    const invoiceNumber = editingId ? invoices.find((i) => i.id === editingId).invoiceNumber : nextDocNumber(invoices, "PINV", "invoiceNumber");
    const jLines = buildJLines(supplier, computedLines, vatTotal, grandTotal);
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: supplier.company, date, memo: `فاتورة مشتريات ${invoiceNumber} — ${supplier.name}`, lines: jLines }]);
    const cleanLines = computedLines.map(({ account, description, quantity, unitPrice, discountPct, subtotal: st, vat, total }) => ({ account, description, quantity: Number(quantity), unitPrice: Number(unitPrice), discountPct: Number(discountPct), subtotal: st, vat, total }));

    if (editingId) {
      setInvoices((prev) => prev.map((i) => (i.id === editingId ? { ...i, supplierId: supplier.id, date, lines: cleanLines, subtotal, vatTotal, grandTotal, journalEntryId: entryId, status: "posted" } : i)));
    } else {
      setInvoices((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((i) => i.id)) + 1 : 1, invoiceNumber, company: supplier.company, supplierId: supplier.id, date, lines: cleanLines, subtotal, vatTotal, grandTotal, journalEntryId: entryId, status: "posted" }]);
    }
    resetForm();
  };

  const startEdit = (inv) => {
    if (inv.status === "posted") return;
    setEditingId(inv.id); setSupplierId(inv.supplierId); setDate(inv.date);
    setLines(inv.lines.map((l) => ({ ...l }))); setPreviewInvoice(null);
  };
  const deleteInvoice = (inv) => {
    if (inv.status === "posted") return;
    if (!window.confirm(`حذف الفاتورة ${inv.invoiceNumber}؟`)) return;
    setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
  };
  const unpostInvoice = (inv) => {
    setEntries((prev) => prev.filter((e) => e.id !== inv.journalEntryId));
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "draft", journalEntryId: null } : i)));
    setUnpostTarget(null);
  };
  const repostInvoice = (inv) => {
    const s = suppliers.find((x) => x.id === inv.supplierId);
    if (!s) return;
    const jLines = buildJLines(s, inv.lines, inv.vatTotal, inv.grandTotal);
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: s.company, date: inv.date, memo: `فاتورة مشتريات ${inv.invoiceNumber} — ${s.name}`, lines: jLines }]);
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "posted", journalEntryId: entryId } : i)));
  };
  const exportInvoiceCsv = (inv) => {
    const s = suppliers.find((x) => x.id === inv.supplierId);
    const rows = [["الوصف", "الكمية", "سعر الوحدة", "خصم %", "قبل الضريبة", "الضريبة", "الإجمالي"]];
    inv.lines.forEach((l) => rows.push([l.description || l.account, l.quantity, l.unitPrice, l.discountPct, l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2)]));
    downloadCsv(`${inv.invoiceNumber}_${s?.name || ""}.csv`, rows);
  };

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل الفاتورة {invoices.find((i) => i.id === editingId)?.invoiceNumber}</div>}
        <div className="form-grid header-grid">
          <label>المورد
            <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
              {companySuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {companySuppliers.length === 0 && <p className="empty">لا يوجد موردون مسجّلون لهذا الكيان — أضف مورداً أولاً.</p>}

        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الحساب</th><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>خصم %</th><th>الإجمالي شامل الضريبة</th><th></th></tr></thead>
            <tbody>
              {computedLines.map((l, idx) => (
                <tr key={idx}>
                  <td><select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}>{PURCHASE_LINE_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
                  <td><input type="text" value={l.description} onChange={(e) => updateLine(idx, "description", e.target.value)} placeholder="وصف الصنف/الخدمة" /></td>
                  <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, "quantity", e.target.value)} /></td>
                  <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, "unitPrice", e.target.value)} placeholder="0.00" /></td>
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
          <div className="preview-row"><span>ضريبة القيمة المضافة (15٪)</span><strong>{fmt(vatTotal)} ر.س</strong></div>
          <div className="preview-row net-row"><span>الإجمالي شامل الضريبة</span><strong>{fmt(grandTotal)} ر.س</strong></div>
        </div>

        <div className="journal-actions">
          <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
          <div className="form-btn-group">
            {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء التعديل</button>}
            <button className="btn-primary" onClick={saveInvoice} disabled={!supplier || grandTotal <= 0}>{editingId ? "حفظ التعديلات وإعادة الترحيل" : "حفظ وترحيل الفاتورة"}</button>
          </div>
        </div>
      </div>

      {(() => {
        const filtered = list.filter((inv) => {
          const s = suppliers.find((x) => x.id === inv.supplierId);
          if (searchText && !(inv.invoiceNumber.includes(searchText) || (s?.name || "").includes(searchText))) return false;
          if (statusFilter !== "all" && (inv.status || "posted") !== statusFilter) return false;
          return true;
        });
        const postedCount = list.filter((i) => (i.status || "posted") !== "draft").length;
        const draftCount = list.length - postedCount;
        const byMonth = {};
        list.forEach((i) => { const m = i.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + i.grandTotal; });
        const months = Object.keys(byMonth).sort().slice(-5);

        return (
          <>
            <div className="analytics-row">
              <MiniDonut
                title="توزيع فواتير المشتريات حسب الترحيل"
                segments={[
                  { label: "مرحّلة", value: postedCount, color: "#2F5D5A" },
                  { label: "مسودة", value: draftCount, color: "#B98B4E" },
                ]}
              />
              <MiniBarChart
                title="إجمالي المشتريات آخر 5 أشهر"
                bars={months.map((m) => ({ label: monthLabel(m).split(" ")[0], value: byMonth[m], color: "#8A5A3E" }))}
              />
            </div>

            <div className="panel">
              <div className="filter-bar">
                <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="بحث برقم الفاتورة أو اسم المورد" />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">كل حالات الترحيل</option>
                  <option value="posted">مرحّلة</option>
                  <option value="draft">مسودة</option>
                </select>
              </div>
              <div className="invoices-table-wrap">
                <table className="invoices-table">
                  <thead><tr><th>الفاتورة</th><th>المورد</th><th>التاريخ</th><th>الإجمالي</th><th>الترحيل</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {filtered.slice().reverse().map((inv) => {
                      const s = suppliers.find((x) => x.id === inv.supplierId);
                      const posted = inv.status !== "draft";
                      return (
                        <tr key={inv.id}>
                          <td>{inv.invoiceNumber}</td><td>{s?.name}</td><td>{inv.date}</td>
                          <td className="num strong">{fmt(inv.grandTotal)}</td>
                          <td><span className={"status-pill " + (posted ? "pill-posted" : "pill-draft")}>{posted ? "مرحّلة" : "مسودة"}</span></td>
                          <td>
                            <TxIconBar
                              onView={() => setPreviewInvoice(inv)}
                              onPrint={() => { setPreviewInvoice(inv); setTimeout(() => printWithOrientation(false), 200); }}
                              onExcel={() => exportInvoiceCsv(inv)}
                              onEdit={!posted ? () => startEdit(inv) : undefined}
                              onDelete={!posted ? () => deleteInvoice(inv) : undefined}
                              onPost={!posted ? () => repostInvoice(inv) : undefined}
                              onUnpost={() => setUnpostTarget(inv)}
                              posted={posted}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && <p className="empty">لا توجد فواتير مطابقة.</p>}
              </div>
            </div>
          </>
        );
      })()}

      {unpostTarget && <UnpostConfirm unlockPin={unlockPin} onCancel={() => setUnpostTarget(null)} onConfirm={() => unpostInvoice(unpostTarget)} />}

      <ExcelImportPanel
        title="فواتير المشتريات"
        exampleRows={[{ "رقم مرجعي": "REF1", "المورد": "اسم المورد بالضبط كما هو مسجّل", "التاريخ": "2026-07-20", "الحساب": PURCHASE_LINE_ACCOUNTS[0], "الوصف": "وصف الصنف", "الكمية": 1, "سعر الوحدة": 100, "خصم %": 0 }]}
        onImportRows={(rows) => {
          const groups = {};
          rows.forEach((r) => {
            const ref = r["رقم مرجعي"] || "بدون رقم";
            groups[ref] = groups[ref] || [];
            groups[ref].push(r);
          });
          let created = 0, skipped = 0;
          Object.entries(groups).forEach(([ref, rrows]) => {
            const supplierName = rrows[0]["المورد"];
            const sup = suppliers.find((s) => s.name === supplierName);
            if (!sup) { skipped += rrows.length; return; }
            const lns = rrows.map((r) => computeInvoiceLine({ quantity: Number(r["الكمية"] || 0), unitPrice: Number(r["سعر الوحدة"] || 0), discountPct: Number(r["خصم %"] || 0) }));
            const cLines = rrows.map((r, idx) => ({ account: r["الحساب"] || PURCHASE_LINE_ACCOUNTS[0], description: r["الوصف"] || "", quantity: Number(r["الكمية"] || 0), unitPrice: Number(r["سعر الوحدة"] || 0), discountPct: Number(r["خصم %"] || 0), ...lns[idx] }));
            const subtotal = cLines.reduce((s, l) => s + l.subtotal, 0);
            const vatT = cLines.reduce((s, l) => s + l.vat, 0);
            const grand = subtotal + vatT;
            const invoiceNumber = nextDocNumber(invoices, "PINV", "invoiceNumber");
            const jLines = buildJLines(sup, cLines, vatT, grand);
            const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
            setEntries((prev) => [...prev, { id: entryId, company: sup.company, date: String(rrows[0]["التاريخ"]), memo: `فاتورة مشتريات ${invoiceNumber} — ${sup.name} (استيراد)`, lines: jLines }]);
            setInvoices((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((i) => i.id)) + 1 : 1, invoiceNumber, company: sup.company, supplierId: sup.id, date: String(rrows[0]["التاريخ"]), lines: cLines, subtotal, vatTotal: vatT, grandTotal: grand, journalEntryId: entryId, status: "posted" }]);
            created++;
          });
          return `تم إنشاء ${created} فاتورة${skipped ? `، وتجاهل ${skipped} صف (مورد غير موجود بنفس الاسم بالضبط)` : ""}.`;
        }}
      />

      {previewInvoice && (() => {
        const s = suppliers.find((x) => x.id === previewInvoice.supplierId);
        const company = COMPANIES.find((x) => x.id === previewInvoice.company);
        return (
          <PrintShell subtitle="فاتورة مشتريات" company={company} refNode={<><div>رقم الفاتورة: <strong>{previewInvoice.invoiceNumber}</strong></div><div>التاريخ: <strong>{previewInvoice.date}</strong></div></>} onClose={() => setPreviewInvoice(null)}>
            <div className="voucher-meta">
              <div><span>المورد</span><strong>{s?.name}</strong></div>
              <div><span>الرقم الضريبي للمورد</span><strong>{s?.vatNumber || "—"}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {previewInvoice.lines.map((l, i) => (
                  <tr key={i}><td>{l.description || l.account}</td><td className="num">{l.quantity}</td><td className="num">{fmt2(l.unitPrice)}</td><td className="num">{fmt(l.subtotal)}</td><td className="num">{fmt(l.vat)}</td><td className="num strong">{fmt(l.total)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(previewInvoice.subtotal)}</td><td className="num strong">{fmt(previewInvoice.vatTotal)}</td><td className="num strong">{fmt(previewInvoice.grandTotal)}</td></tr></tfoot>
            </table>
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المشتريات: مردودات المشتريات ============ */

export function PurchaseReturnsModule({ suppliers, invoices, returns, setReturns, entries, setEntries, companyId }) {
  const companySuppliers = companyId === "all" ? suppliers : suppliers.filter((s) => s.company === companyId);
  const [supplierId, setSupplierId] = useState(companySuppliers[0]?.id || "");
  const [date, setDate] = useState("2026-07-20");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ account: PURCHASE_LINE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0 }]);
  const [previewReturn, setPreviewReturn] = useState(null);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const list = returns.filter((r) => companySuppliers.some((s) => s.id === r.supplierId));
  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, { account: PURCHASE_LINE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0 }]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const saveReturn = () => {
    if (!supplier || grandTotal <= 0) return;
    const returnNumber = nextDocNumber(returns, "PRET", "returnNumber");
    const byAccount = {};
    computedLines.forEach((l) => { byAccount[l.account] = (byAccount[l.account] || 0) + l.subtotal; });
    const jLines = Object.entries(byAccount).map(([account, amount]) => ({
      account, costCenter: "", department: "المشتريات", debit: 0, credit: amount, supplierId: supplier.id,
    }));
    jLines.push({ account: "ضريبة القيمة المضافة - مدخلات", costCenter: "", department: "المالية والحسابات", debit: 0, credit: vatTotal, supplierId: supplier.id });
    jLines.push({ account: "ذمم دائنة - موردين", costCenter: "", department: "المالية والحسابات", debit: grandTotal, credit: 0, supplierId: supplier.id });

    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: supplier.company, date, memo: `مردود مشتريات ${returnNumber} — ${supplier.name}`, lines: jLines }]);

    setReturns((prev) => [
      ...prev,
      {
        id: prev.length ? Math.max(...prev.map((r) => r.id)) + 1 : 1,
        returnNumber, company: supplier.company, supplierId: supplier.id, date, reason,
        lines: computedLines.map(({ account, description, quantity, unitPrice, discountPct, subtotal: st, vat, total }) => ({ account, description, quantity: Number(quantity), unitPrice: Number(unitPrice), discountPct: Number(discountPct), subtotal: st, vat, total })),
        subtotal, vatTotal, grandTotal, journalEntryId: entryId,
      },
    ]);
    setLines([{ account: PURCHASE_LINE_ACCOUNTS[0], description: "", quantity: 1, unitPrice: "", discountPct: 0 }]); setReason("");
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>المورد<select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>{companySuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>تاريخ المردود<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">سبب المردود<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الحساب</th><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>خصم %</th><th>الإجمالي شامل الضريبة</th><th></th></tr></thead>
            <tbody>
              {computedLines.map((l, idx) => (
                <tr key={idx}>
                  <td><select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}>{PURCHASE_LINE_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
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
          <button className="btn-primary" onClick={saveReturn} disabled={!supplier || grandTotal <= 0}>حفظ وترحيل المردود</button>
        </div>
      </div>

      <div className="entries-feed">
        {list.slice().reverse().map((r) => {
          const s = suppliers.find((x) => x.id === r.supplierId);
          return (
            <div className="panel entry-card" key={r.id}>
              <div className="entry-card-head">
                <div><span className="entry-memo">{r.returnNumber} — {s?.name}</span><span className="entry-meta">{r.date} {r.reason ? `· ${r.reason}` : ""}</span></div>
                <span className="entry-total">-{fmt(r.grandTotal)} ر.س</span>
              </div>
              <div className="entry-card-actions"><button className="btn-ghost" onClick={() => setPreviewReturn(r)}>معاينة / طباعة</button></div>
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا توجد مردودات مسجّلة بعد.</p>}
      </div>

      {previewReturn && (() => {
        const s = suppliers.find((x) => x.id === previewReturn.supplierId);
        const company = COMPANIES.find((x) => x.id === previewReturn.company);
        return (
          <PrintShell subtitle="إشعار مدين — مردود مشتريات" company={company} refNode={<><div>رقم المردود: <strong>{previewReturn.returnNumber}</strong></div><div>التاريخ: <strong>{previewReturn.date}</strong></div></>} onClose={() => setPreviewReturn(null)}>
            <div className="voucher-meta"><div><span>المورد</span><strong>{s?.name}</strong></div><div><span>السبب</span><strong>{previewReturn.reason || "—"}</strong></div></div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الوصف</th><th>الكمية</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>{previewReturn.lines.map((l, i) => (<tr key={i}><td>{l.description || l.account}</td><td className="num">{l.quantity}</td><td className="num">{fmt(l.subtotal)}</td><td className="num">{fmt(l.vat)}</td><td className="num strong">{fmt(l.total)}</td></tr>))}</tbody>
              <tfoot><tr><td className="foot-label" colSpan={4}>الإجمالي</td><td className="num strong">{fmt(previewReturn.grandTotal)}</td></tr></tfoot>
            </table>
          </PrintShell>
        );
      })()}
    </div>
  );
}

/* ============ المشتريات: التقارير ============ */

export const PURCHASE_REPORT_TABS = [
  { id: "bySupplier", label: "حسب المورد" },
  { id: "monthly", label: "الاتجاه الشهري" },
  { id: "aging", label: "أعمار الذمم الدائنة" },
  { id: "vat", label: "ملخص الضريبة" },
];

export function PurchaseReportsModule({ suppliers, invoices, returns, entries, companyId }) {
  const [tab, setTab] = useState("bySupplier");
  const companySuppliers = companyId === "all" ? suppliers : suppliers.filter((s) => s.company === companyId);
  const companyInvoices = invoices.filter((i) => companySuppliers.some((s) => s.id === i.supplierId));
  const companyReturns = returns.filter((r) => companySuppliers.some((s) => s.id === r.supplierId));

  return (
    <div>
      <div className="report-tabs">{PURCHASE_REPORT_TABS.map((t) => (<button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>))}</div>

      {tab === "bySupplier" && (
        <div className="panel">
          <h3>المشتريات حسب المورد</h3>
          <table className="ledger-table">
            <thead><tr><th>المورد</th><th>عدد الفواتير</th><th>إجمالي الفواتير</th><th>إجمالي المردودات</th><th>صافي المشتريات</th><th>المستحق له</th></tr></thead>
            <tbody>
              {companySuppliers.map((s) => {
                const supInv = companyInvoices.filter((i) => i.supplierId === s.id);
                const supRet = companyReturns.filter((r) => r.supplierId === s.id);
                const invTotal = supInv.reduce((sm, i) => sm + i.grandTotal, 0);
                const retTotal = supRet.reduce((sm, r) => sm + r.grandTotal, 0);
                const balance = supplierAccountBalance(entries, s.id);
                return (<tr key={s.id}><td>{s.name}</td><td className="num">{supInv.length}</td><td className="num">{fmt(invTotal)}</td><td className="num">{fmt(retTotal)}</td><td className="num strong">{fmt(invTotal - retTotal)}</td><td className="num">{fmt(balance)}</td></tr>);
              })}
            </tbody>
          </table>
          {companySuppliers.length === 0 && <p className="empty">لا يوجد موردون بعد.</p>}
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
            <h3>اتجاه المشتريات الشهري</h3>
            <table className="ledger-table">
              <thead><tr><th>الشهر</th><th>عدد الفواتير</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>{months.map((m) => (<tr key={m}><td>{monthLabel(m)}</td><td className="num">{byMonth[m].count}</td><td className="num">{fmt(byMonth[m].subtotal)}</td><td className="num">{fmt(byMonth[m].vat)}</td><td className="num strong">{fmt(byMonth[m].total)}</td></tr>))}</tbody>
            </table>
            {months.length === 0 && <p className="empty">لا توجد فواتير مسجّلة بعد.</p>}
          </div>
        );
      })()}

      {tab === "aging" && (
        <div className="panel">
          <h3>أعمار الذمم الدائنة (حتى 2026-07-20)</h3>
          <table className="ledger-table">
            <thead><tr><th>المورد</th><th>0-30 يوم</th><th>31-60 يوم</th><th>61-90 يوم</th><th>أكثر من 90 يوم</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {companySuppliers.map((s) => {
                const balance = supplierAccountBalance(entries, s.id);
                if (balance <= 0.5) return null;
                const supInv = companyInvoices.filter((i) => i.supplierId === s.id);
                const b = agingBuckets(supInv, balance, "2026-07-20", "date", "grandTotal");
                return (<tr key={s.id}><td>{s.name}</td><td className="num">{fmt(b.current)}</td><td className="num">{fmt(b.d30)}</td><td className="num">{fmt(b.d60)}</td><td className="num balance-bad">{fmt(b.d90)}</td><td className="num strong">{fmt(balance)}</td></tr>);
              })}
            </tbody>
          </table>
          {companySuppliers.every((s) => supplierAccountBalance(entries, s.id) <= 0.5) && <p className="empty">لا توجد أرصدة مستحقة حالياً.</p>}
        </div>
      )}

      {tab === "vat" && (() => {
        const inputVatInvoices = companyInvoices.reduce((s, i) => s + i.vatTotal, 0);
        const inputVatReturns = companyReturns.reduce((s, r) => s + r.vatTotal, 0);
        const netVat = inputVatInvoices - inputVatReturns;
        return (
          <>
            <div className="gauge-row gauge-row-3">
              <Gauge label="ضريبة مدخلات الفواتير" value={inputVatInvoices} max={100000} unit="ر.س" tone="#2F5D5A" />
              <Gauge label="ضريبة مدخلات المردودات" value={inputVatReturns} max={30000} unit="ر.س" tone="#A8432B" />
              <Gauge label="صافي ضريبة المشتريات القابلة للخصم" value={Math.max(netVat, 0)} max={100000} unit="ر.س" tone="#B98B4E" />
            </div>
            <div className="panel">
              <table className="ledger-table">
                <tbody>
                  <tr><td>إجمالي ضريبة المدخلات على الفواتير</td><td className="num">{fmt(inputVatInvoices)} ر.س</td></tr>
                  <tr><td>إجمالي ضريبة المدخلات على المردودات (تُخصم)</td><td className="num">-{fmt(inputVatReturns)} ر.س</td></tr>
                  <tr className="net-row"><td className="strong">صافي ضريبة المشتريات القابلة للاسترداد/الخصم</td><td className="num strong">{fmt(netVat)} ر.س</td></tr>
                </tbody>
              </table>
            </div>
          </>
        );
      })()}
    </div>
  );
}

export const PURCHASE_TABS = [
  { id: "suppliers", label: "الموردون" },
  { id: "invoices", label: "فواتير المشتريات" },
  { id: "returns", label: "مردودات المشتريات" },
  { id: "reports", label: "التقارير" },
];

export function PurchasesModule({ suppliers, setSuppliers, invoices, setInvoices, returns, setReturns, entries, setEntries, companyId, tab, setTab, unlockPin }) {
  return (
    <div>
      <div className="section-title"><span className="eyebrow">التوريد والمشتريات</span><h2>المشتريات</h2></div>
      <div className="report-tabs">{PURCHASE_TABS.map((t) => (<button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>))}</div>
      {tab === "suppliers" && <SupplierDirectory suppliers={suppliers} setSuppliers={setSuppliers} entries={entries} companyId={companyId} />}
      {tab === "invoices" && <PurchaseInvoiceModule suppliers={suppliers} invoices={invoices} setInvoices={setInvoices} entries={entries} setEntries={setEntries} companyId={companyId} unlockPin={unlockPin} />}
      {tab === "returns" && <PurchaseReturnsModule suppliers={suppliers} invoices={invoices} returns={returns} setReturns={setReturns} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "reports" && <PurchaseReportsModule suppliers={suppliers} invoices={invoices} returns={returns} entries={entries} companyId={companyId} />}
    </div>
  );
}
