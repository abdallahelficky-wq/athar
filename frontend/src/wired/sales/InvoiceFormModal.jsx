import React, { useEffect, useState } from "react";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listSellableItems } from "../../api/sellableItems";
import { createSalesInvoice, updateSalesInvoice, postSalesInvoice } from "../../api/salesInvoices";
import SalesInvoiceLinesEditor, { emptySalesLine } from "./SalesInvoiceLinesEditor";
import NewCustomerModal from "./NewCustomerModal";
import NewSellableItemModal from "./NewSellableItemModal";
import InvoiceViewModal from "./InvoiceViewModal";

const lineFromExisting = (l) => ({
  accountId: l.accountId,
  sellableItemId: l.sellableItemId || "",
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
  const isEdit = !!editingInvoice;
  const seed = editingInvoice || duplicateFrom;

  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [sellableItems, setSellableItems] = useState([]);

  const [customerId, setCustomerId] = useState(seed?.customerId || "");
  const [customerSearchText, setCustomerSearchText] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [date, setDate] = useState(() => (isEdit ? seed.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [lines, setLines] = useState(() => (seed ? seed.lines.map(lineFromExisting) : [emptySalesLine()]));

  const [newCustomerModal, setNewCustomerModal] = useState(null);
  const [newItemModal, setNewItemModal] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then(setCustomers);
    listAccounts({ companyId }).then((accs) => setAccounts(accs.filter((a) => a.type === "revenue")));
    listSellableItems(companyId).then(setSellableItems);
  }, [companyId]);

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
    setSellableItems((prev) => [item, ...prev]);
    setLines((prev) => prev.map((l, i) => (i === newItemModal.idx ? {
      ...l,
      sellableItemId: item.id,
      description: item.name,
      accountId: item.defaultRevenueAccountId,
      unitPrice: Number(item.defaultUnitPrice),
      vatApplicable: item.vatApplicable,
    } : l)));
    setNewItemModal(null);
  };

  const cleanLines = () => lines.filter((l) => l.accountId && Number(l.unitPrice) > 0);

  const buildPayload = () => ({ companyId, customerId, date, lines: cleanLines() });

  const submit = async (post) => {
    if (!customerId) { setError("اختر عميلاً أولاً"); return; }
    if (cleanLines().length === 0) { setError("أضف سطراً واحداً على الأقل بحساب وسعر صحيحين"); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateSalesInvoice(editingInvoice.id, buildPayload());
        if (post) await postSalesInvoice(editingInvoice.id);
        onSaved(post ? "تم حفظ التعديلات وترحيل الفاتورة، وأُنشئ القيد المحاسبي المرتبط بها." : "تم حفظ التعديلات كمسودة.");
      } else {
        await createSalesInvoice({ ...buildPayload(), post });
        onSaved(post ? "تم حفظ الفاتورة وترحيلها، وأُنشئ القيد المحاسبي المرتبط بها." : "تم حفظ الفاتورة كمسودة.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="invoice-modal-overlay">
      <div className="invoice-modal-box">
        <h3>
          {isEdit ? `تعديل الفاتورة ${editingInvoice.invoiceNumber}`
            : duplicateFrom ? `فاتورة جديدة (نسخ من ${duplicateFrom.invoiceNumber})`
              : "فاتورة مبيعات جديدة"}
        </h3>

        <div className="form-grid header-grid">
          <label className="item-combo-cell">
            العميل
            <input
              type="text"
              value={customerDropdownOpen ? customerSearchText : (selectedCustomer?.name || "")}
              onChange={(e) => { setCustomerSearchText(e.target.value); setCustomerId(""); setCustomerDropdownOpen(true); }}
              onFocus={() => { setCustomerSearchText(selectedCustomer?.name || ""); setCustomerDropdownOpen(true); }}
              onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
              placeholder="ابحث عن عميل أو اكتب اسماً جديداً"
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
                  + إضافة عميل جديد {customerSearchText ? `باسم "${customerSearchText}"` : ""}
                </div>
              </div>
            )}
          </label>
          <label>تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">
            نوع الفاتورة (تلقائي)
            <input
              type="text" readOnly
              value={invType === "standard" ? "فاتورة ضريبية قياسية (B2B)" : invType === "simplified" ? "فاتورة ضريبية مبسّطة (B2C)" : "اختر عميلاً أولاً"}
            />
          </label>
        </div>

        {customers.length === 0 && <p className="empty">لا يوجد عملاء بعد — اكتب اسماً في حقل العميل أعلاه لإضافته.</p>}

        <SalesInvoiceLinesEditor
          lines={lines}
          setLines={setLines}
          accounts={accounts}
          sellableItems={sellableItems}
          onRequestNewItem={(idx, searchText) => setNewItemModal({ idx, initialName: searchText })}
        />

        {error && <p className="balance-bad">{error}</p>}

        <div className="form-btn-group">
          {isEdit && <button className="btn-ghost" onClick={() => setPrintInvoice(editingInvoice)}>طباعة</button>}
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-ghost" onClick={() => submit(false)} disabled={saving || !customerId}>حفظ كمسودة</button>
          <button className="btn-primary" onClick={() => submit(true)} disabled={saving || !customerId}>حفظ وترحيل الفاتورة</button>
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
    </div>
  );
}
