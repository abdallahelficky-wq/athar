import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listItems } from "../../api/items";
import { getQuickAccessItems } from "../../api/pos";
import { fmt2 } from "../../legacy/constants";
import { isSellableItem } from "../itemFilters";
import CustomerPickerModal from "../components/CustomerPickerModal";
import QtyInput from "../components/QtyInput";

function lineFromSelection(item, quantity) {
  return {
    itemId: item.id,
    name: item.name,
    unitPrice: item.salePrice != null ? Number(item.salePrice) : 0,
    quantity,
    accountId: item.revenueAccountId,
    vatApplicable: item.vatApplicable,
  };
}

/**
 * شاشة البيع السريعة — مسار مختلف عن SaleScreen عمداً: تحديد دفعة من الأصناف أولاً (بلا كميات
 * بعد)، ثم تحديد الكميات لكل صنف محدَّد في خطوة منفصلة، ثم العميل، ثم الدفع — بدل السلة الحيّة
 * المتزامنة في SaleScreen. لا تُعدِّل SaleScreen ولا تشاركها حالة؛ فقط تنتهي لنفس شكل cart/customer
 * الذي يفهمه PosApp (onProceedToPayment)، فيبقى الانتقال لشاشة الدفع (الكلاسيكية أو السريعة) خارج
 * هذا المكوّن تماماً.
 */
export default function QuickSaleScreen({ companyId, setCart, customer, setCustomer, onProceedToPayment }) {
  const { t } = useTranslation();
  const [step, setStep] = useState("items"); // items | quantities | customer

  const [quickItems, setQuickItems] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // selected: Map(itemId -> { item, quantity }) — يحمل عنصر الاختيار وكميته معاً منذ لحظة التحديد
  // الأولى (qty=1)، فخطوة "الكميات" فقط تُعدِّل قيمة موجودة أصلاً بدل بنائها من الصفر.
  const [selected, setSelected] = useState(new Map());
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  useEffect(() => {
    getQuickAccessItems(companyId).then(setQuickItems).catch(() => setQuickItems([]));
  }, [companyId]);

  useEffect(() => {
    const text = searchText.trim();
    if (!text) { setSearchResults([]); return; }
    setSearching(true);
    const timeout = setTimeout(() => {
      listItems(companyId, { search: text })
        .then((items) => setSearchResults(items.filter(isSellableItem)))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchText, companyId]);

  const displayItems = searchText.trim() ? searchResults : quickItems;
  const selectedCount = selected.size;
  const selectedList = useMemo(() => [...selected.values()], [selected]);

  const toggleItem = (item) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, { item, quantity: 1 });
      return next;
    });
  };

  const changeQuantity = (itemId, delta) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const entry = next.get(itemId);
      if (!entry) return prev;
      const quantity = entry.quantity + delta;
      if (quantity <= 0) next.delete(itemId);
      else next.set(itemId, { ...entry, quantity });
      return next;
    });
  };

  const setQuantity = (itemId, quantity) => {
    setSelected((prev) => {
      const entry = prev.get(itemId);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(itemId, { ...entry, quantity });
      return next;
    });
  };

  const removeSelected = (itemId) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  };

  const goToQuantities = () => { if (selectedCount > 0) setStep("quantities"); };

  const goToCustomer = () => { if (selected.size > 0) setStep("customer"); };

  const finishWithCustomer = (chosenCustomer) => {
    setCustomer(chosenCustomer);
    setCustomerModalOpen(false);
    setCart(selectedList.map(({ item, quantity }) => lineFromSelection(item, quantity)));
    onProceedToPayment();
  };

  if (step === "items") {
    return (
      <div className="pos-quick-sale-screen">
        <div className="pos-search-row">
          <input
            className="pos-search-input"
            type="text"
            placeholder={t("pos.sale.searchPlaceholder")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        {!searchText.trim() && <div className="pos-section-label">{t("pos.sale.bestSelling")}</div>}
        {searching && <p className="m-empty">{t("pos.sale.searching")}</p>}
        {!searching && searchText.trim() && displayItems.length === 0 && <p className="m-empty">{t("pos.sale.noResults")}</p>}
        {!searchText.trim() && displayItems.length === 0 && <p className="m-empty">{t("pos.sale.noSalesYet")}</p>}

        <div className="pos-item-grid pos-quick-item-grid">
          {displayItems.map((item) => {
            const isSelected = selected.has(item.id);
            return (
              <button
                key={item.id}
                className={`pos-item-tile${isSelected ? " pos-item-tile-selected" : ""}`}
                onClick={() => toggleItem(item)}
              >
                {isSelected && <span className="pos-item-tile-check">✓</span>}
                <span className="pos-item-tile-name">{item.name}</span>
                <span className="pos-item-tile-price">{item.salePrice != null ? fmt2(Number(item.salePrice)) : "—"}</span>
              </button>
            );
          })}
        </div>

        <div className="pos-quick-sale-footer">
          <button className="pos-big-btn" disabled={selectedCount === 0} onClick={goToQuantities}>
            {selectedCount > 0
              ? t("pos.quickSale.continueBtnWithCount", { count: selectedCount })
              : t("pos.quickSale.continueBtnEmpty")}
          </button>
        </div>
      </div>
    );
  }

  if (step === "quantities") {
    const total = selectedList.reduce((s, { item, quantity }) => s + Number(item.salePrice || 0) * quantity, 0);
    return (
      <div className="pos-quick-sale-screen">
        <div className="pos-section-label">{t("pos.quickSale.quantitiesTitle")}</div>
        <div className="pos-cart-lines pos-quick-quantities-list">
          {selectedList.map(({ item, quantity }) => (
            <div className="pos-cart-line" key={item.id}>
              <div className="pos-cart-line-info">
                <span className="pos-cart-line-name">{item.name}</span>
                <span className="pos-cart-line-price">
                  {fmt2(Number(item.salePrice || 0))} × {quantity} = {fmt2(Number(item.salePrice || 0) * quantity)}
                </span>
              </div>
              <div className="pos-cart-line-controls">
                <button className="pos-qty-btn" onClick={() => changeQuantity(item.id, -1)}>−</button>
                <QtyInput value={quantity} onChange={(qty) => setQuantity(item.id, qty)} />
                <button className="pos-qty-btn" onClick={() => changeQuantity(item.id, 1)}>+</button>
                <button className="pos-qty-remove" onClick={() => removeSelected(item.id)}>{t("pos.sale.removeBtn")}</button>
              </div>
            </div>
          ))}
        </div>

        <div className="pos-cart-footer">
          <div className="pos-cart-total-row">
            <span>{t("pos.sale.totalLabel")}</span>
            <strong>{fmt2(total)}</strong>
          </div>
          <div className="pos-quick-sale-actions">
            <button className="m-btn secondary" onClick={() => setStep("items")}>{t("pos.quickSale.backToItemsBtn")}</button>
            <button className="pos-big-btn" disabled={selected.size === 0} onClick={goToCustomer}>{t("pos.quickSale.continueToCustomerBtn")}</button>
          </div>
        </div>
      </div>
    );
  }

  // step === "customer"
  return (
    <div className="pos-quick-sale-screen pos-quick-customer-step">
      <div className="pos-section-label">{t("pos.quickSale.customerStepTitle")}</div>
      <p className="pos-payment-mode-hint">{t("pos.quickSale.customerStepHint")}</p>

      <button className="pos-big-btn" onClick={() => finishWithCustomer(null)}>{t("pos.sale.cashCustomer")}</button>
      <button className="m-btn secondary" onClick={() => setCustomerModalOpen(true)}>{t("pos.quickSale.pickCustomerBtn")}</button>
      <button className="m-btn secondary" onClick={() => setStep("quantities")}>{t("pos.quickSale.backToQuantitiesBtn")}</button>

      {customerModalOpen && (
        <CustomerPickerModal
          companyId={companyId}
          onSelect={(c) => finishWithCustomer(c)}
          onClose={() => setCustomerModalOpen(false)}
        />
      )}
    </div>
  );
}
