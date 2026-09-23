import ReturnLinesEditor from "./ReturnLinesEditor";
import { returnInvoiceLines } from "./returnInvoiceLines";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listItems } from "../../api/items";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listSalesInvoices, getSalesInvoice } from "../../api/salesInvoices";
import { createSalesReturn, updateSalesReturn } from "../../api/salesReturns";
import { emptySalesLine as emptyInvoiceLine } from "./SalesInvoiceLinesEditor";
import { currencyLabel } from "../../shared/countries";

/**
 * نافذة (Modal) إنشاء/تعديل إشعار دائن — تحل محل الفورم القديم المدمج مع قائمة شاشة المردودات
 * (ReturnsTab.jsx كانت تعرضه دوماً أعلى القائمة). وضع التعديل (editingReturn) متاح للمسودات فقط
 * (راجع updateSalesReturn في الخادم — يرفض أي حالة أخرى صراحةً). وضع prefillInvoiceId يُبقي تدفّق
 * "↩ إرجاع الفاتورة" من InvoiceCreditNotes.jsx يعمل تماماً كما كان: يفتح هذه النافذة مُعبَّأة
 * مسبقاً بعميل/فاتورة تلك الفاتورة تحديداً.
 */
export default function SalesReturnFormModal({ companyId, companies, editingReturn, prefillInvoiceId, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const isEdit = !!editingReturn;

  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);

  const [customerId, setCustomerId] = useState(editingReturn?.customerId || "");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState(editingReturn?.relatedInvoiceId || "");
  const [date, setDate] = useState(() => (isEdit ? editingReturn.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [reason, setReason] = useState(editingReturn?.reason || "");
  const [refundMethod, setRefundMethod] = useState(editingReturn?.refundMethod || "account");
  const [lines, setLines] = useState(() => (isEdit ? editingReturn.lines.map((l) => ({
    originalInvoiceLineId: l.originalInvoiceLineId || undefined,
    accountId: l.accountId,
    description: l.description || "",
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discountPct: Number(l.discountPct),
    priceIncludesVat: l.priceIncludesVat,
    vatApplicable: l.taxCategoryCode === "S",
    taxCategoryCode: l.taxCategoryCode, taxExemptionReasonCode: l.taxExemptionReasonCode, taxExemptionReason: l.taxExemptionReason,
  })) : [emptyInvoiceLine()]));

  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    Promise.all([listCustomers(companyId), listAccounts({ companyId }), listSalesInvoices(companyId), listItems(companyId)])
      .then(([cs, accs, invs, loadedItems]) => {
        setCustomers(cs); setAccounts(accs.filter((a) => a.type === "revenue")); setInvoices(invs); setItems(loadedItems);
        if (!isEdit && prefillInvoiceId) {
          const invoice = invs.find((inv) => inv.id === prefillInvoiceId && inv.status === "posted");
          if (invoice) { setCustomerId(invoice.customerId); setRelatedInvoiceId(invoice.id); setRefundMethod("account"); }
          else setError(t("creditNote.unavailable"));
        } else if (!isEdit && !customerId) {
          setCustomerId(cs[0]?.id || "");
        }
      }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // في وضع التعديل، لو المردود مرتبط بفاتورة أصلية، تُجلَب فقط لتقييد حقول الأسطر المرتبطة بها
  // (سعر/خصم/حساب) للقراءة فقط، بنفس قيد إنشاء إشعار من فاتورة تماماً — سطور المسودة الفعلية
  // (editingReturn.lines) تبقى هي المصدر الوحيد للكميات المعروضة، لا تُستبدَل بسطور الفاتورة.
  useEffect(() => {
    if (!isEdit || !editingReturn.relatedInvoiceId) return;
    let cancelled = false;
    getSalesInvoice(editingReturn.relatedInvoiceId).then((invoice) => !cancelled && setSelectedInvoice(invoice)).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, editingReturn?.relatedInvoiceId]);

  // إعادة جلب الفاتورة الأصلية المختارة (سطورها المرجعية بالضبط) — لا يُشغَّل عند فتح التعديل
  // (يُغطّى بالتأثير أعلاه بدلاً منه) لأن سطور المسودة الحالية (editingReturn.lines) هي المصدر
  // الصحيح للكميات، لا سطور الفاتورة الأصلية من جديد.
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    setSelectedInvoice(null); setError("");
    if (!relatedInvoiceId) { setLines([emptyInvoiceLine()]); setLoadingInvoice(false); return; }
    setLoadingInvoice(true); setLines([]);
    getSalesInvoice(relatedInvoiceId).then((invoice) => {
      if (cancelled) return;
      if (invoice.companyId !== companyId || invoice.customerId !== customerId || invoice.status !== "posted") throw new Error(t("creditNote.unavailable"));
      setSelectedInvoice(invoice); setLines(returnInvoiceLines(invoice));
    }).catch((e) => !cancelled && setError(e.message)).finally(() => !cancelled && setLoadingInvoice(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedInvoiceId, companyId, customerId, isEdit]);

  const customerInvoices = invoices.filter((i) => i.customerId === customerId && i.status === "posted");

  const save = async () => {
    if (!customerId || saving || loadingInvoice) return;
    if (relatedInvoiceId && !isEdit && (!selectedInvoice || !reason.trim())) { setError(t("creditNote.reasonRequired")); return; }
    setError("");
    setSaving(true);
    try {
      const payload = {
        companyId, customerId, relatedInvoiceId: relatedInvoiceId || undefined, date, reason, refundMethod,
        lines: lines.filter((l) => l.accountId && Number(l.quantity) > 0).map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) })),
      };
      if (isEdit) {
        await updateSalesReturn(editingReturn.id, payload);
        onSaved(t("sales.returns.form.savedEdit", { number: editingReturn.returnNumber }));
      } else {
        const created = await createSalesReturn(payload);
        onSaved(t(created.status === "posted" ? "creditNote.saved" : "creditNote.savedPending", { number: created.returnNumber }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="invoice-modal-box">
        <div className="modal-title-row">
          <h3>{isEdit ? t("sales.returns.form.titleEdit", { number: editingReturn.returnNumber }) : t("sales.returns.form.titleCreate")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("sales.returns.form.close")}>×</button>
        </div>

        <div className="form-grid header-grid">
          <label>{t("sales.returns.customer")}
            <select value={customerId} disabled={isEdit} onChange={(e) => { setCustomerId(e.target.value); setRelatedInvoiceId(""); }}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("sales.returns.originalInvoice")}
            <select value={relatedInvoiceId} disabled={isEdit} onChange={(e) => setRelatedInvoiceId(e.target.value)}>
              <option value="">{t("sales.returns.noLink")}</option>
              {customerInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber}</option>)}
            </select>
          </label>
          <label>{t("sales.returns.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{t("sales.returns.refundMethod")}
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="account">{t("sales.returns.refundAccount")}</option>
              <option value="cash">{t("sales.returns.refundCash")}</option>
              <option value="bank">{t("sales.returns.refundBank")}</option>
            </select>
          </label>
          <label className="memo-field">{t("sales.returns.reason")}<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>

        {loadingInvoice ? <p>{t("salesInvoices.loading")}</p> : (
          <ReturnLinesEditor lines={lines} setLines={setLines} invoice={selectedInvoice} items={items} accounts={accounts} currency={currency} />
        )}
        {selectedInvoice && !isEdit && <p>{t("creditNote.editHint")}</p>}
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("sales.returns.form.cancel")}</button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={!customerId || saving || loadingInvoice || !lines.some((line) => Number(line.quantity) > 0) || (!!relatedInvoiceId && !isEdit && !selectedInvoice)}
          >
            {isEdit ? t("sales.returns.form.saveChanges") : t("sales.returns.saveAndPost")}
          </button>
        </div>
      </div>
    </div>
  );
}
