import React, { useEffect, useState } from "react";
import { listSuppliers } from "../../api/suppliers";
import { listAccounts } from "../../api/accounts";
import {
  listPurchaseInvoices, createPurchaseInvoice, deletePurchaseInvoice, postPurchaseInvoice, unpostPurchaseInvoice,
} from "../../api/purchaseInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import InvoiceLinesEditor, { emptyInvoiceLine } from "../shared/InvoiceLinesEditor";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import PurchaseInvoiceViewModal from "./PurchaseInvoiceViewModal";

export default function PurchaseInvoicesTab({ companyId, companies }) {
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ ...emptyInvoiceLine(), priceIncludesVat: false }]);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    listSuppliers(companyId).then((ss) => { setSuppliers(ss); if (ss[0]) setSupplierId((s) => s || ss[0].id); });
    listAccounts().then(setAccounts);
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listPurchaseInvoices(companyId).then(setInvoices).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!supplierId) return;
    try {
      await createPurchaseInvoice({ companyId, supplierId, date, lines: lines.filter((l) => l.accountId && Number(l.unitPrice) > 0) });
      setLines([{ ...emptyInvoiceLine(), priceIncludesVat: false }]);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (inv) => {
    if (!window.confirm(`حذف الفاتورة ${inv.invoiceNumber}؟`)) return;
    try {
      await deletePurchaseInvoice(inv.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doPost = async (inv) => {
    try {
      await postPurchaseInvoice(inv.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostPurchaseInvoice(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>المورد<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {suppliers.length === 0 && <p className="empty">أضف مورداً أولاً من تبويب "الموردون".</p>}

        <InvoiceLinesEditor lines={lines} setLines={setLines} accounts={accounts} />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!supplierId}>حفظ وترحيل الفاتورة</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الرقم</th><th>المورد</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <React.Fragment key={inv.id}>
                  <tr>
                    <td>{inv.invoiceNumber}</td><td>{inv.supplier?.name}</td><td>{inv.date.slice(0, 10)}</td>
                    <td className="num">{fmt(inv.grandTotal)}</td>
                    <td><span className="status-badge">{inv.status === "posted" ? "مرحّلة" : "مسودة"}</span></td>
                    <td className="row-actions">
                      <button className="icon-btn" title="عرض الفاتورة" onClick={() => setViewInvoice(inv)}><Icon.Eye /></button>
                      <button
                        className="icon-btn" title="طباعة الفاتورة"
                        onClick={() => { setViewInvoice(inv); setAutoPrint(true); }}
                      ><Icon.Printer /></button>
                      {inv.status === "draft" && (
                        <>
                          <button className="btn-ghost" onClick={() => remove(inv)}>حذف</button>
                          <button className="btn-primary" onClick={() => doPost(inv)}>ترحيل</button>
                        </>
                      )}
                      {inv.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostTarget(inv)}>فك الترحيل</button>}
                      <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === inv.id ? null : inv.id)}>
                        {attachmentsFor === inv.id ? "إخفاء المرفقات" : "المرفقات"}
                      </button>
                    </td>
                  </tr>
                  {attachmentsFor === inv.id && (
                    <tr><td colSpan={6}><AttachmentsPanel entityType="purchase_invoice" entityId={inv.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {invoices.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد فواتير مشتريات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}

      {viewInvoice && (
        <PurchaseInvoiceViewModal
          invoice={viewInvoice}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewInvoice(null); setAutoPrint(false); }}
        />
      )}
    </div>
  );
}
