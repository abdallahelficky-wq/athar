import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listItems } from "../../api/items";
import { listBranches } from "../../api/branches";
import { currencyLabel } from "../../shared/countries";
import { createSalesInvoice, updateSalesInvoice, postSalesInvoice } from "../../api/salesInvoices";
import SalesInvoiceLinesEditor, { emptySalesLine } from "./SalesInvoiceLinesEditor";
import NewCustomerModal from "./NewCustomerModal";
import NewSellableItemModal from "./NewSellableItemModal";
import InvoiceViewModal from "./InvoiceViewModal";
import { useUnsavedChangesGuard } from "../shared/UnsavedChangesContext";

const lineFromExisting = (l) => ({
  accountId: l.accountId,
  itemId: l.itemId || "",
  description: l.description || "",
  quantity: Number(l.quantity),
  unitPrice: Number(l.unitPrice),
  discountPct: Number(l.discountPct),
  priceIncludesVat: l.priceIncludesVat,
  vatApplicable: l.vatApplicable,
});

/**
 * نافذة (Modal) إنشاء/تعديل/نسخ فاتورة مبيعات — تحل محل الفورم القديم المدمج مع القائمة.
 * وضع النسخ (duplicateFrom) يُعامَل كإنشاء فاتورة جديدة مُعبَّأة مسبقاً ببيانات فاتورة أخرى.
 */
export default function InvoiceFormModal({ companyId, companies, editingInvoice, duplicateFrom, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const isEdit = !!editingInvoice;
  const seed = editingInvoice || duplicateFrom;

  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);

  const [customerId, setCustomerId] = useState(seed?.customerId || "");
  const [customerSearchText, setCustomerSearchText] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [date, setDate] = useState(() => (isEdit ? seed.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [branchId, setBranchId] = useState(seed?.branchId || "");
  const [dueDate, setDueDate] = useState(seed?.dueDate ? seed.dueDate.slice(0, 10) : "");
  const [customerReference, setCustomerReference] = useState(seed?.customerReference || "");
  const [poNumber, setPoNumber] = useState(seed?.poNumber || "");
  const [salesperson, setSalesperson] = useState(seed?.salesperson || "");
  const [otherId, setOtherId] = useState(seed?.otherId || "");
  const [lines, setLines] = useState(() => (seed ? seed.lines.map(lineFromExisting) : [emptySalesLine()]));

  const [newCustomerModal, setNewCustomerModal] = useState(null);
  const [newItemModal, setNewItemModal] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // "تغييرات غير محفوظة" — راجع نفس التعليق في JournalEntryFormModal.jsx لتفاصيل الآلية.
  const mountedRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    setDirty(true);
  }, [customerId, date, branchId, dueDate, customerReference, poNumber, salesperson, otherId, lines]);
  useUnsavedChangesGuard(dirty);

  // راجع نفس التعليق في JournalEntryFormModal.jsx: إغلاق النافذة نفسها (×/خارجها/إلغاء) لا يمرّ
  // عبر useBlocker لأنه ليس تنقّلاً بين مسارات، فيُفحَص dirty هنا صراحة قبل الإغلاق الفعلي.
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then(setCustomers);
    listAccounts({ companyId }).then((accs) => setAccounts(accs.filter((a) => a.type === "revenue")));
    listItems(companyId).then(setItems);
    listBranches(companyId).then(setBranches);
  }, [companyId]);

  const branchOptions = branches.filter((b) => b.isActive || b.id === branchId);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const invType = selectedCustomer ? (selectedCustomer.customerType === "business" && selectedCustomer.vatNumber ? "standard" : "simplified") : null;
  const filteredCustomers = customers.filter((c) => !customerSearchText || c.name.includes(customerSearchText));

  const pickCustomer = (c) => {
    setCustomerId(c.id);
    setCustomerDropdownOpen(false);
  };

  const handleCustomerCreated = (customer) => {
    setCustomers((prev) => [customer, ...prev]);
    setCustomerId(customer.id);
    setNewCustomerModal(null);
  };

  const handleItemCreated = (item) => {
    setItems((prev) => [item, ...prev]);
    setLines((prev) => prev.map((l, i) => (i === newItemModal.idx ? {
      ...l,
      itemId: item.id,
      description: item.name,
      accountId: item.revenueAccountId,
      unitPrice: item.salePrice != null ? Number(item.salePrice) : 0,
      vatApplicable: item.vatApplicable,
    } : l)));
    setNewItemModal(null);
  };

  const cleanLines = () => lines.filter((l) => l.accountId && Number(l.unitPrice) > 0);

  const buildPayload = () => ({
    companyId, customerId, branchId: branchId || null, date,
    dueDate: dueDate || null, customerReference: customerReference || undefined,
    poNumber: poNumber || undefined, salesperson: salesperson || undefined, otherId: otherId || undefined,
    lines: cleanLines(),
  });

  // إرسال الفاتورة بالإيميل يحدث فقط عند الترحيل الفعلي (لا عند الحفظ كمسودة) — النتيجة تصل هنا
  // ضمن استجابة الترحيل/الإنشاء نفسها، فتُضاف كجملة توضيحية لرسالة النجاح بدل نافذة منفصلة.
  const emailSuffix = (emailResult) => {
    if (!emailResult) return "";
    if (emailResult.sent) return t("salesInvoices.form.emailSuffixSent");
    if (emailResult.reason === "no_email") return t("salesInvoices.form.emailSuffixNoEmail");
    return t("salesInvoices.form.emailSuffixFailed");
  };

  const submit = async (post) => {
    if (!customerId) { setError(t("salesInvoices.form.errChooseCustomer")); return; }
    if (cleanLines().length === 0) { setError(t("salesInvoices.form.errAddLine")); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateSalesInvoice(editingInvoice.id, buildPayload());
        let emailResult;
        if (post) { const result = await postSalesInvoice(editingInvoice.id); emailResult = result.emailResult; }
        onSaved((post ? t("salesInvoices.form.savedEditPosted") : t("salesInvoices.form.savedEditDraft")) + emailSuffix(emailResult));
      } else {
        const result = await createSalesInvoice({ ...buildPayload(), post });
        onSaved((post ? t("salesInvoices.form.savedNewPosted") : t("salesInvoices.form.savedNewDraft")) + emailSuffix(result.emailResult));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && requestClose()}>
      <div className="invoice-modal-box">
        <div className="modal-title-row">
          <h3>
            {isEdit ? t("salesInvoices.form.titleEdit", { number: editingInvoice.invoiceNumber })
              : duplicateFrom ? t("salesInvoices.form.titleDuplicate", { number: duplicateFrom.invoiceNumber })
                : t("salesInvoices.form.titleCreate")}
          </h3>
          <button type="button" className="modal-close-btn" onClick={requestClose} disabled={saving} aria-label={t("salesInvoices.form.close")}>×</button>
        </div>

        <div className="form-grid header-grid">
          <label className="item-combo-cell">
            {t("salesInvoices.form.customer")}
            <input
              type="text"
              value={customerDropdownOpen ? customerSearchText : (selectedCustomer?.name || "")}
              onChange={(e) => { setCustomerSearchText(e.target.value); setCustomerId(""); setCustomerDropdownOpen(true); }}
              onFocus={() => { setCustomerSearchText(selectedCustomer?.name || ""); setCustomerDropdownOpen(true); }}
              onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
              placeholder={t("salesInvoices.form.customerSearchPlaceholder")}
            />
            {customerDropdownOpen && (
              <div className="item-combo-dropdown">
                {filteredCustomers.map((c) => (
                  <div key={c.id} className="item-combo-option" onMouseDown={() => pickCustomer(c)}>{c.name}</div>
                ))}
                <div
                  className="item-combo-option item-combo-new"
                  onMouseDown={() => { setCustomerDropdownOpen(false); setNewCustomerModal({ initialName: customerSearchText }); }}
                >
                  {customerSearchText ? t("salesInvoices.form.addNewCustomerNamed", { name: customerSearchText }) : t("salesInvoices.form.addNewCustomer")}
                </div>
              </div>
            )}
          </label>
          <label>{t("salesInvoices.form.invoiceDate")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {branchOptions.length > 0 && (
            <label>
              {t("journalEntries.form.branchLabel")}
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">{t("common.clearOption")}</option>
                {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
              </select>
            </label>
          )}
          <label className="memo-field">
            {t("salesInvoices.form.invoiceTypeAuto")}
            <input
              type="text" readOnly
              value={invType === "standard" ? t("salesInvoices.form.invoiceTypeStandard") : invType === "simplified" ? t("salesInvoices.form.invoiceTypeSimplified") : t("salesInvoices.form.invoiceTypeChooseCustomer")}
            />
          </label>
        </div>

        {/* حقول اختيارية إضافية تظهر في شريط معلومات الفاتورة لبعض القوالب (مثل "كلاسيكي احترافي")
            — لا تأثير محاسبي/ضريبي لها إطلاقاً، وتبقى فارغة بلا أي إلزام. */}
        <details className="invoice-extra-fields">
          <summary>{t("salesInvoices.form.extraFieldsToggle")}</summary>
          <div className="form-grid">
            <label>{t("salesInvoices.form.dueDate")}<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
            <label>{t("salesInvoices.form.customerReference")}<input type="text" value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} /></label>
            <label>{t("salesInvoices.form.poNumber")}<input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></label>
            <label>{t("salesInvoices.form.salesperson")}<input type="text" value={salesperson} onChange={(e) => setSalesperson(e.target.value)} /></label>
            <label>{t("salesInvoices.form.otherId")}<input type="text" value={otherId} onChange={(e) => setOtherId(e.target.value)} /></label>
          </div>
        </details>

        {customers.length === 0 && <p className="empty">{t("salesInvoices.form.noCustomersYet")}</p>}

        <SalesInvoiceLinesEditor
          lines={lines}
          setLines={setLines}
          accounts={accounts}
          items={items}
          currency={currency}
          onRequestNewItem={(idx, searchText) => setNewItemModal({ idx, initialName: searchText })}
        />

        {error && <p className="balance-bad">{error}</p>}

        <div className="form-btn-group">
          {isEdit && <button className="btn-ghost" onClick={() => setPrintInvoice(editingInvoice)}>{t("salesInvoices.form.print")}</button>}
          <button className="btn-ghost" onClick={requestClose} disabled={saving}>{t("salesInvoices.form.cancel")}</button>
          <button className="btn-ghost" onClick={() => submit(false)} disabled={saving || !customerId}>{t("salesInvoices.form.saveDraft")}</button>
          <button className="btn-primary" onClick={() => submit(true)} disabled={saving || !customerId}>{t("salesInvoices.form.saveAndPost")}</button>
        </div>
      </div>

      {newCustomerModal && (
        <NewCustomerModal
          companyId={companyId}
          initialName={newCustomerModal.initialName}
          onClose={() => setNewCustomerModal(null)}
          onCreated={handleCustomerCreated}
        />
      )}
      {newItemModal && (
        <NewSellableItemModal
          companyId={companyId}
          accounts={accounts}
          initialName={newItemModal.initialName}
          onClose={() => setNewItemModal(null)}
          onCreated={handleItemCreated}
        />
      )}
      {printInvoice && <InvoiceViewModal invoice={printInvoice} companies={companies} onClose={() => setPrintInvoice(null)} />}

      {confirmClose && (
        <div className="unsaved-changes-overlay" onClick={(e) => e.target === e.currentTarget && setConfirmClose(false)}>
          <div className="unsaved-changes-box">
            <h3>{t("unsavedChanges.title")}</h3>
            <p>{t("unsavedChanges.body")}</p>
            <div className="unsaved-changes-actions">
              <button type="button" className="btn-ghost" onClick={() => setConfirmClose(false)}>{t("unsavedChanges.stayOnPage")}</button>
              <button type="button" className="btn-primary unsaved-changes-leave-btn" onClick={onClose}>{t("unsavedChanges.leaveWithoutSaving")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
