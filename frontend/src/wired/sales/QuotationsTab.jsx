import React, { useEffect, useState } from "react";
import { listQuotations, deleteQuotation, convertQuotationToInvoice } from "../../api/quotations";
import { getSalesInvoice } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import QuotationFormModal from "./QuotationFormModal";
import QuotationViewModal from "./QuotationViewModal";
import InvoiceViewModal from "./InvoiceViewModal";

const STATUS_LABEL = { draft: "مسودة", converted: "تم التحويل" };

/**
 * قائمة عروض الأسعار — بنفس نمط InvoicesTab.jsx (قائمة فقط + نافذة منفصلة للإنشاء/التعديل +
 * أيقونات إجراءات كاملة)، يحل محل الفورم المدمج القديم الذي لم يكن يدعم تعديلاً ولا طباعة.
 */
export default function QuotationsTab({ companyId, companies }) {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();

  const [formModal, setFormModal] = useState(null);
  const [viewQuotation, setViewQuotation] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [convertedInvoice, setConvertedInvoice] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listQuotations(companyId).then(setQuotations).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  const onSaved = (message) => {
    setFormModal(null);
    reload();
    notify(message);
  };

  const onPrintClick = (q) => {
    setViewQuotation(q);
    setAutoPrint(true);
  };

  const onDuplicateClick = (q) => setFormModal({ mode: "duplicate", quotation: q });

  const onConvertClick = async (q) => {
    if (!window.confirm(`تحويل عرض السعر ${q.quoteNumber} إلى فاتورة مبيعات؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      const invoice = await convertQuotationToInvoice(q.id);
      reload();
      notify(`تم تحويل عرض السعر ${q.quoteNumber} إلى الفاتورة ${invoice.invoiceNumber}، ورُحِّل قيدها المحاسبي تلقائياً.`);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const onDeleteClick = async (q) => {
    if (q.status === "converted") { notify("لا يمكن حذف عرض سعر تم تحويله لفاتورة.", "error"); return; }
    if (!window.confirm(`حذف عرض السعر ${q.quoteNumber}؟`)) return;
    try {
      await deleteQuotation(q.id);
      reload();
      notify(`تم حذف عرض السعر ${q.quoteNumber}.`);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const onViewInvoiceClick = async (q) => {
    try {
      const invoice = await getSalesInvoice(q.convertedInvoiceId);
      setConvertedInvoice(invoice);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  return (
    <div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>+ إضافة عرض سعر</button>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table responsive-table">
            <thead>
              <tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>صالح حتى</th><th>الإجمالي</th><th>الحالة</th><th>الإجراءات</th></tr>
            </thead>
            <tbody>
              {quotations.map((q) => {
                const converted = q.status === "converted";
                return (
                  <tr key={q.id}>
                    <td data-label="الرقم">{q.quoteNumber}</td>
                    <td data-label="العميل">{q.customer?.name}</td>
                    <td data-label="التاريخ">{q.date.slice(0, 10)}</td>
                    <td data-label="صالح حتى">{q.validUntil ? q.validUntil.slice(0, 10) : "—"}</td>
                    <td className="num" data-label="الإجمالي">{fmt(Number(q.grandTotal))}</td>
                    <td data-label="الحالة"><span className="status-badge">{STATUS_LABEL[q.status] || q.status}</span></td>
                    <td className="row-actions">
                      <button className="icon-btn" title="عرض عرض السعر" onClick={() => setViewQuotation(q)}><Icon.Eye /></button>
                      <button className="icon-btn" title="طباعة عرض السعر" onClick={() => onPrintClick(q)}><Icon.Printer /></button>
                      <button
                        className="icon-btn"
                        title={converted ? "لا يمكن تعديل عرض سعر تم تحويله لفاتورة" : "تعديل عرض السعر"}
                        disabled={converted}
                        onClick={() => setFormModal({ mode: "edit", quotation: q })}
                      ><Icon.Edit /></button>
                      <button className="icon-btn" title="نسخ عرض السعر (عرض جديد بنفس البيانات)" onClick={() => onDuplicateClick(q)}><Icon.Copy /></button>
                      {converted ? (
                        <button className="icon-btn" title="عرض الفاتورة الناتجة" onClick={() => onViewInvoiceClick(q)}><Icon.BookOpen /></button>
                      ) : (
                        <button className="icon-btn" title="تحويل إلى فاتورة مبيعات" onClick={() => onConvertClick(q)}><Icon.Convert /></button>
                      )}
                      <button
                        className="icon-btn icon-btn-danger"
                        title={converted ? "لا يمكن حذف عرض سعر تم تحويله لفاتورة" : "حذف عرض السعر"}
                        disabled={converted}
                        onClick={() => onDeleteClick(q)}
                      ><Icon.Trash /></button>
                    </td>
                  </tr>
                );
              })}
              {quotations.length === 0 && <tr><td className="empty" colSpan={7}>لا توجد عروض أسعار بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {formModal && (
        <QuotationFormModal
          companyId={companyId}
          companies={companies}
          editingQuotation={formModal.mode === "edit" ? formModal.quotation : null}
          duplicateFrom={formModal.mode === "duplicate" ? formModal.quotation : null}
          onClose={() => setFormModal(null)}
          onSaved={onSaved}
        />
      )}

      {viewQuotation && (
        <QuotationViewModal
          quotation={viewQuotation}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewQuotation(null); setAutoPrint(false); }}
        />
      )}

      {convertedInvoice && (
        <InvoiceViewModal invoice={convertedInvoice} companies={companies} onClose={() => setConvertedInvoice(null)} />
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
