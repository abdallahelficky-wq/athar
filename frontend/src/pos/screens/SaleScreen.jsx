import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listItems, getItemByBarcode } from "../../api/items";
import { getQuickAccessItems } from "../../api/pos";
import { fmt2 } from "../../legacy/constants";
import { useAuth } from "../../context/AuthContext";
import BarcodeScannerModal from "../components/BarcodeScannerModal";
import CustomerPickerModal from "../components/CustomerPickerModal";
import QtyInput from "../components/QtyInput";
import { isSellableItem } from "../itemFilters";

// نفس افتراض priceIncludesVat في نموذج الفاتورة العادية (SalesInvoiceLinesEditor.jsx:
// emptySalesLine) — سعر الصنف (salePrice) شامل الضريبة دائماً بالاصطلاح، وZod يطبّق نفس الافتراض
// true تلقائياً حتى لو حُذف الحقل من الطلب (راجع تقرير الميزة)، فهذا لا يغيّر أي رقم فعلي، فقط
// يجعله صريحاً في الواجهة بدل ضمنيّته السابقة.
function lineFromItem(item) {
  return {
    itemId: item.id,
    name: item.name,
    unitPrice: item.salePrice != null ? Number(item.salePrice) : 0,
    originalPrice: item.salePrice != null ? Number(item.salePrice) : 0,
    quantity: 1,
    accountId: item.revenueAccountId,
    vatApplicable: item.vatApplicable,
    priceIncludesVat: true,
  };
}

export default function SaleScreen({ companyId, cart, setCart, customer, setCustomer, onProceedToPayment }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canOverridePrice = Boolean(user?.canOverridePosPrice);
  const [quickItems, setQuickItems] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [error, setError] = useState("");

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

  const addItemToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, lineFromItem(item)];
    });
  };

  const onBarcodeDetected = async (code) => {
    setScannerOpen(false);
    try {
      const item = await getItemByBarcode(companyId, code);
      if (!item) { setError(t("pos.sale.barcodeNotFound", { code })); return; }
      setError("");
      addItemToCart(item);
    } catch {
      setError(t("pos.sale.barcodeSearchError"));
    }
  };

  const updateQty = (itemId, delta) => {
    setCart((prev) => prev
      .map((l) => (l.itemId === itemId ? { ...l, quantity: l.quantity + delta } : l))
      .filter((l) => l.quantity > 0));
  };

  const setQty = (itemId, quantity) => {
    setCart((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)));
  };

  // كلاهما محمي مضاعفاً: الواجهة تُخفي حقل السعر تماماً (للقراءة فقط) بلا صلاحية posPriceOverride،
  // والخادم (pos.service.ts/detectAndAuthorizePriceOverrides) هو التحقق الحاسم فعلياً — تعديل هذه
  // الدالة نفسها بلا صلاحية حقيقية على الخادم لن يُغيّر شيئاً، الطلب سيُرفَض بـ403.
  const setUnitPrice = (itemId, unitPrice) => {
    setCart((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, unitPrice } : l)));
  };

  const setPriceIncludesVat = (itemId, priceIncludesVat) => {
    setCart((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, priceIncludesVat } : l)));
  };

  const removeLine = (itemId) => setCart((prev) => prev.filter((l) => l.itemId !== itemId));

  const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const displayItems = searchText.trim() ? searchResults : quickItems;

  return (
    <div className="pos-sale-screen">
      <div className="pos-catalog">
        <div className="pos-search-row">
          <input
            className="pos-search-input"
            type="text"
            placeholder={t("pos.sale.searchPlaceholder")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button className="pos-scan-btn" onClick={() => setScannerOpen(true)}>{t("pos.sale.scanBtn")}</button>
        </div>
        {error && <p className="m-error">{error}</p>}

        {!searchText.trim() && <div className="pos-section-label">{t("pos.sale.bestSelling")}</div>}
        {searching && <p className="m-empty">{t("pos.sale.searching")}</p>}
        {!searching && searchText.trim() && displayItems.length === 0 && <p className="m-empty">{t("pos.sale.noResults")}</p>}
        {!searchText.trim() && displayItems.length === 0 && <p className="m-empty">{t("pos.sale.noSalesYet")}</p>}

        <div className="pos-item-grid">
          {displayItems.map((item) => (
            <button key={item.id} className="pos-item-tile" onClick={() => addItemToCart(item)}>
              <span className="pos-item-tile-name">{item.name}</span>
              <span className="pos-item-tile-price">{item.salePrice != null ? fmt2(Number(item.salePrice)) : "—"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pos-cart">
        <div className="pos-cart-customer" onClick={() => setCustomerModalOpen(true)}>
          <span>{t("pos.sale.customerLabel")}</span>
          <strong>{customer?.name || t("pos.sale.cashCustomer")}</strong>
          <span className="pos-cart-customer-change">{t("pos.sale.changeCustomer")}</span>
        </div>

        <div className="pos-cart-lines">
          {cart.length === 0 && <p className="m-empty">{t("pos.sale.emptyCart")}</p>}
          {cart.map((line) => (
            <div className="pos-cart-line" key={line.itemId}>
              <div className="pos-cart-line-info">
                <span className="pos-cart-line-name">{line.name}</span>
                {canOverridePrice ? (
                  <span className="pos-cart-line-price-edit">
                    <input
                      type="number"
                      inputMode="decimal"
                      className="pos-price-input"
                      value={line.unitPrice}
                      onChange={(e) => setUnitPrice(line.itemId, Number(e.target.value) || 0)}
                    />
                    <span>× {line.quantity} = {fmt2(line.unitPrice * line.quantity)}</span>
                  </span>
                ) : (
                  <span className="pos-cart-line-price">{fmt2(line.unitPrice)} × {line.quantity} = {fmt2(line.unitPrice * line.quantity)}</span>
                )}
              </div>
              <label className="pos-price-vat-toggle">
                <input
                  type="checkbox"
                  checked={line.priceIncludesVat}
                  onChange={(e) => setPriceIncludesVat(line.itemId, e.target.checked)}
                />
                {t("pos.sale.priceIncludesVat")}
              </label>
              <div className="pos-cart-line-controls">
                <button className="pos-qty-btn" onClick={() => updateQty(line.itemId, -1)}>−</button>
                <QtyInput value={line.quantity} onChange={(qty) => setQty(line.itemId, qty)} />
                <button className="pos-qty-btn" onClick={() => updateQty(line.itemId, 1)}>+</button>
                <button className="pos-qty-remove" onClick={() => removeLine(line.itemId)}>{t("pos.sale.removeBtn")}</button>
              </div>
            </div>
          ))}
        </div>

        <div className="pos-cart-footer">
          <div className="pos-cart-total-row">
            <span>{t("pos.sale.totalLabel")}</span>
            <strong>{fmt2(cartTotal)}</strong>
          </div>
          <button className="pos-big-btn" disabled={cart.length === 0} onClick={onProceedToPayment}>
            {t("pos.sale.proceedBtn")}
          </button>
        </div>
      </div>

      {scannerOpen && <BarcodeScannerModal onDetected={onBarcodeDetected} onClose={() => setScannerOpen(false)} />}
      {customerModalOpen && (
        <CustomerPickerModal
          companyId={companyId}
          onSelect={(c) => { setCustomer(c); setCustomerModalOpen(false); }}
          onClose={() => setCustomerModalOpen(false)}
        />
      )}
    </div>
  );
}
