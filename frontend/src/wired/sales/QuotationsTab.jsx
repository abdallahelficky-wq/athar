import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listQuotations, deleteQuotation, convertQuotationToInvoice } from "../../api/quotations";
import { getSalesInvoice } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import QuotationFormModal from "./QuotationFormModal";
import QuotationViewModal from "./QuotationViewModal";
import InvoiceViewModal from "./InvoiceViewModal";

/**
 * قائمة عروض الأسعار — بنفس نمط InvoicesTab.jsx (قائمة فقط + نافذة منفصلة للإنشاء/التعديل +
 * أيقونات إجراءات كاملة)، يحل محل الفورم المدمج القديم الذي لم يكن يدعم تعديلاً ولا طباعة.
 */
export default function QuotationsTab({ companyId, companies }) {
  const { t } = useTranslation();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();

  const [formModal, setFormModal] = useState(null);
  const [viewQuotation, setViewQuotation] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [convertedInvoice, setConvertedInvoice] = useState(null);

  const STATUS_LABEL = { draft: t("sales.quotations.status.draft"), converted: t("sales.quotations.status.converted") };

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listQuotations(companyId).then(setQuotations).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

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
    if (!window.confirm(t("sales.quotations.confirmConvert", { number: q.quoteNumber }))) return;
    try {
      const invoice = await convertQuotationToInvoice(q.id);
      reload();
      notify(t("sales.quotations.convertedMsg", { number: q.quoteNumber, invoiceNumber: invoice.invoiceNumber }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const onDeleteClick = async (q) => {
    if (q.status === "converted") { notify(t("sales.quotations.cannotDeleteConverted"), "error"); return; }
    if (!window.confirm(t("sales.quotations.confirmDelete", { number: q.quoteNumber }))) return;
    try {
      await deleteQuotation(q.id);
      reload();
      notify(t("sales.quotations.deleted", { number: q.quoteNumber }));
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
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>{t("sales.quotations.addBtn")}</button>
      </div>

      {loading ? <p className="empty">{t("sales.quotations.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table responsive-table">
            <thead>
              <tr>
                <th>{t("sales.quotations.table.number")}</th><th>{t("sales.quotations.table.customer")}</th>
                <th>{t("sales.quotations.table.date")}</th><th>{t("sales.quotations.table.validUntil")}</th>
                <th>{t("sales.quotations.table.total")}</th><th>{t("sales.quotations.table.status")}</th>
                <th>{t("sales.quotations.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => {
                const converted = q.status === "converted";
                return (
                  <tr key={q.id}>
                    <td data-label={t("sales.quotations.table.number")}>{q.quoteNumber}</td>
                    <td data-label={t("sales.quotations.table.customer")}>{q.customer?.name}</td>
                    <td data-label={t("sales.quotations.table.date")}>{q.date.slice(0, 10)}</td>
                    <td data-label={t("sales.quotations.table.validUntil")}>{q.validUntil ? q.validUntil.slice(0, 10) : "—"}</td>
                    <td className="num" data-label={t("sales.quotations.table.total")}>{fmt(Number(q.grandTotal))}</td>
                    <td data-label={t("sales.quotations.table.status")}><span className="status-badge">{STATUS_LABEL[q.status] || q.status}</span></td>
                    <td className="row-actions">
                      <button className="icon-btn" title={t("sales.quotations.actions.view")} onClick={() => setViewQuotation(q)}><Icon.Eye /></button>
                      <button className="icon-btn" title={t("sales.quotations.actions.print")} onClick={() => onPrintClick(q)}><Icon.Printer /></button>
                      <button
                        className="icon-btn"
                        title={converted ? t("sales.quotations.actions.editDisabled") : t("sales.quotations.actions.edit")}
                        disabled={converted}
                        onClick={() => setFormModal({ mode: "edit", quotation: q })}
                      ><Icon.Edit /></button>
                      <button className="icon-btn" title={t("sales.quotations.actions.duplicate")} onClick={() => onDuplicateClick(q)}><Icon.Copy /></button>
                      {converted ? (
                        <button className="icon-btn" title={t("sales.quotations.actions.viewInvoice")} onClick={() => onViewInvoiceClick(q)}><Icon.BookOpen /></button>
                      ) : (
                        <button className="icon-btn" title={t("sales.quotations.actions.convert")} onClick={() => onConvertClick(q)}><Icon.Convert /></button>
                      )}
                      <button
                        className="icon-btn icon-btn-danger"
                        title={converted ? t("sales.quotations.actions.deleteDisabled") : t("sales.quotations.actions.delete")}
                        disabled={converted}
                        onClick={() => onDeleteClick(q)}
                      ><Icon.Trash /></button>
                    </td>
                  </tr>
                );
              })}
              {quotations.length === 0 && <tr><td className="empty" colSpan={7}>{t("sales.quotations.empty")}</td></tr>}
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
