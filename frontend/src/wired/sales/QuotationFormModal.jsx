import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listItems } from "../../api/items";
import { createQuotation, updateQuotation } from "../../api/quotations";
import SalesInvoiceLinesEditor, { emptySalesLine } from "./SalesInvoiceLinesEditor";
import NewCustomerModal from "./NewCustomerModal";
import NewSellableItemModal from "./NewSellableItemModal";
import QuotationViewModal from "./QuotationViewModal";

const lineFromExisting = (l) => ({
  accountId: l.accountId,
  itemId: l.itemId || "",
  description: l.description || "",
  quantity: Number(l.quantity),
  unitPrice: Number(l.unitPrice),
  discountPct: Number(l.discountPct),
  priceIncludesVat: l.priceIncludesVat,
  vatApplicable: l.vatApplicable !== false,
});

/**
 * نافذة (Modal) إنشاء/تعديل/نسخ عرض سعر — بنفس نمط InvoiceFormModal.jsx حرفياً، بما في ذلك
 * إضافة عميل/صنف جديد من داخل النافذة (Nested Modals). لا يوجد مفهوم "ترحيل" لعروض الأسعار
 * (فقط مسودة/محوَّل) فالحفظ هنا دائماً يُبقيها مسودة — التحويل الفعلي لفاتورة له زر منفصل
 * في قائمة عروض الأسعار.
 */
export default function QuotationFormModal({ companyId, companies, editingQuotation, duplicateFrom, onClose, onSaved }) {
  const { t } = useTranslation();
  const isEdit = !!editingQuotation;
  const seed = editingQuotation || duplicateFrom;

  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [items, setItems] = useState([]);

  const [customerId, setCustomerId] = useState(seed?.customerId || "");
  const [customerSearchText, setCustomerSearchText] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [date, setDate] = useState(() => (seed ? seed.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [validUntil, setValidUntil] = useState(() => (seed?.validUntil ? seed.validUntil.slice(0, 10) : ""));
  const [lines, setLines] = useState(() => (seed ? seed.lines.map(lineFromExisting) : [emptySalesLine()]));

  const [newCustomerModal, setNewCustomerModal] = useState(null);
  const [newItemModal, setNewItemModal] = useState(null);
  const [printQuotation, setPrintQuotation] = useState(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then(setCustomers);
    listAccounts({ companyId }).then((accs) => setAccounts(accs.filter((a) => a.type === "revenue")));
    listItems(companyId).then(setItems);
  }, [companyId]);

  const selectedCustomer = customers.find((c) => c.id === customerId);
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

  const buildPayload = () => ({ companyId, customerId, date, validUntil: validUntil || undefined, lines: cleanLines() });

  const submit = async () => {
    if (!customerId) { setError(t("sales.quotations.form.errChooseCustomer")); return; }
    if (cleanLines().length === 0) { setError(t("sales.quotations.form.errAddLine")); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateQuotation(editingQuotation.id, buildPayload());
        onSaved(t("sales.quotations.form.savedEdit"));
      } else {
        await createQuotation(buildPayload());
        onSaved(duplicateFrom ? t("sales.quotations.form.savedDuplicate") : t("sales.quotations.form.savedNew"));
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
          <h3>
            {isEdit ? t("sales.quotations.form.titleEdit", { number: editingQuotation.quoteNumber })
              : duplicateFrom ? t("sales.quotations.form.titleDuplicate", { number: duplicateFrom.quoteNumber })
                : t("sales.quotations.form.titleCreate")}
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("sales.quotations.form.close")}>×</button>
        </div>

        <div className="form-grid header-grid">
          <label className="item-combo-cell">
            {t("sales.quotations.form.customer")}
            <input
              type="text"
              value={customerDropdownOpen ? customerSearchText : (selectedCustomer?.name || "")}
              onChange={(e) => { setCustomerSearchText(e.target.value); setCustomerId(""); setCustomerDropdownOpen(true); }}
              onFocus={() => { setCustomerSearchText(selectedCustomer?.name || ""); setCustomerDropdownOpen(true); }}
              onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
              placeholder={t("sales.quotations.form.customerSearchPlaceholder")}
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
                  {customerSearchText ? t("sales.quotations.form.addNewCustomerNamed", { name: customerSearchText }) : t("sales.quotations.form.addNewCustomer")}
                </div>
              </div>
            )}
          </label>
          <label>{t("sales.quotations.form.quoteDate")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{t("sales.quotations.form.validUntil")}<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
        </div>

        {customers.length === 0 && <p className="empty">{t("sales.quotations.form.noCustomersYet")}</p>}

        <SalesInvoiceLinesEditor
          lines={lines}
          setLines={setLines}
          accounts={accounts}
          items={items}
          onRequestNewItem={(idx, searchText) => setNewItemModal({ idx, initialName: searchText })}
        />

        {error && <p className="balance-bad">{error}</p>}

        <div className="form-btn-group">
          {isEdit && <button className="btn-ghost" onClick={() => setPrintQuotation(editingQuotation)}>{t("sales.quotations.form.print")}</button>}
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("sales.quotations.form.cancel")}</button>
          <button className="btn-primary" onClick={submit} disabled={saving || !customerId}>{isEdit ? t("sales.quotations.form.saveChanges") : t("sales.quotations.form.saveQuote")}</button>
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
      {printQuotation && <QuotationViewModal quotation={printQuotation} companies={companies} onClose={() => setPrintQuotation(null)} />}
    </div>
  );
}
