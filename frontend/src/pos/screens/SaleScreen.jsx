import React, { useEffect, useState } from "react";
import { listItems, getItemByBarcode } from "../../api/items";
import { getQuickAccessItems } from "../../api/pos";
import { fmt2 } from "../../legacy/constants";
import BarcodeScannerModal from "../components/BarcodeScannerModal";
import CustomerPickerModal from "../components/CustomerPickerModal";

function isSellableItem(item) {
  if (item.type === "expense" || item.type === "fixed_asset") return false;
  if (item.type === "raw_material") return item.allowDirectSale === true;
  return true;
}

function lineFromItem(item) {
  return {
    itemId: item.id,
    name: item.name,
    unitPrice: item.salePrice != null ? Number(item.salePrice) : 0,
    quantity: 1,
    accountId: item.revenueAccountId,
    vatApplicable: item.vatApplicable,
  };
}

export default function SaleScreen({ companyId, cart, setCart, customer, setCustomer, onProceedToPayment }) {
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
      if (!item) { setError(`لا يوجد صنف بهذا الباركود: ${code}`); return; }
      setError("");
      addItemToCart(item);
    } catch {
      setError("تعذّر البحث عن الصنف بالباركود");
    }
  };

  const updateQty = (itemId, delta) => {
    setCart((prev) => prev
      .map((l) => (l.itemId === itemId ? { ...l, quantity: l.quantity + delta } : l))
      .filter((l) => l.quantity > 0));
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
            placeholder="ابحث بالاسم أو الكود..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button className="pos-scan-btn" onClick={() => setScannerOpen(true)}>📷 مسح باركود</button>
        </div>
        {error && <p className="m-error">{error}</p>}

        {!searchText.trim() && <div className="pos-section-label">الأكثر مبيعاً</div>}
        {searching && <p className="m-empty">جارٍ البحث...</p>}
        {!searching && searchText.trim() && displayItems.length === 0 && <p className="m-empty">لا توجد نتائج</p>}
        {!searchText.trim() && displayItems.length === 0 && <p className="m-empty">لا توجد مبيعات بعد لعرض الأكثر مبيعاً — استخدم البحث</p>}

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
          <span>العميل</span>
          <strong>{customer?.name || "عميل نقدي"}</strong>
          <span className="pos-cart-customer-change">تغيير ›</span>
        </div>

        <div className="pos-cart-lines">
          {cart.length === 0 && <p className="m-empty">السلة فارغة — ابحث أو امسح صنفاً</p>}
          {cart.map((line) => (
            <div className="pos-cart-line" key={line.itemId}>
              <div className="pos-cart-line-info">
                <span className="pos-cart-line-name">{line.name}</span>
                <span className="pos-cart-line-price">{fmt2(line.unitPrice)} × {line.quantity} = {fmt2(line.unitPrice * line.quantity)}</span>
              </div>
              <div className="pos-cart-line-controls">
                <button className="pos-qty-btn" onClick={() => updateQty(line.itemId, -1)}>−</button>
                <span className="pos-qty-value">{line.quantity}</span>
                <button className="pos-qty-btn" onClick={() => updateQty(line.itemId, 1)}>+</button>
                <button className="pos-qty-remove" onClick={() => removeLine(line.itemId)}>حذف</button>
              </div>
            </div>
          ))}
        </div>

        <div className="pos-cart-footer">
          <div className="pos-cart-total-row">
            <span>الإجمالي</span>
            <strong>{fmt2(cartTotal)}</strong>
          </div>
          <button className="pos-big-btn" disabled={cart.length === 0} onClick={onProceedToPayment}>
            متابعة للدفع
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
