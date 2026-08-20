import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { computeInvoiceLine } from "../shared/invoiceLine";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "../shared/AccountSearchSelect";

export const emptyPurchaseLine = () => ({
  accountId: "", itemId: "", warehouseId: "", usefulLifeYears: "", salvageValue: "",
  description: "", quantity: 1, unitPrice: "", discountPct: 0, priceIncludesVat: false,
});

const NOT_PURCHASABLE_TYPES = ["service", "bundle"];

/**
 * محرر أسطر فاتورة المشتريات — نسخة مخصَّصة (لا تُستخدَم في المبيعات) تضيف حقل "الصنف" كقائمة
 * بحث من كتالوج الأصناف الفعلي، مع حقول ديناميكية حسب نوع الصنف المختار: مستودع للأصناف
 * المخزنية، أو عمر إنتاجي/قيمة خردة لأصناف الأصول الثابتة. الحساب المحاسبي يُشتق تلقائياً من
 * نوع الصنف عند الترحيل (لا يُرسَل من هنا لهذه الأسطر) — حقل الحساب اليدوي يظهر فقط للأسطر
 * الحرة بلا صنف مختار (مصاريف متفرقة).
 */
export default function PurchaseInvoiceLinesEditor({ lines, setLines, accounts, items, warehouses, currency: currencyProp }) {
  const { t } = useTranslation();
  const [openDropdownIdx, setOpenDropdownIdx] = useState(null);
  const [searchText, setSearchText] = useState("");

  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  const currency = currencyProp || t("common.currency");

  const purchasableItems = items.filter((i) => !NOT_PURCHASABLE_TYPES.includes(i.type));

  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyPurchaseLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const pickItem = (idx, item) => {
    updateLine(idx, {
      itemId: item.id,
      description: item.name,
      warehouseId: item.type === "fixed_asset" ? "" : (warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || ""),
      usefulLifeYears: "",
      salvageValue: "",
      unitPrice: item.lastPurchasePrice != null ? Number(item.lastPurchasePrice) : "",
    });
    setOpenDropdownIdx(null);
  };

  const clearItem = (idx, text) => updateLine(idx, { itemId: "", description: text, warehouseId: "", usefulLifeYears: "", salvageValue: "" });

  const filtered = (text) => purchasableItems.filter((it) => !text || it.name.includes(text) || it.code?.includes(text));

  return (
    <div>
      <div className="lines-table-wrap">
        <table className="lines-table">
          <thead>
            <tr>
              <th>{t("purchases.invoices.lines.itemDescription")}</th><th>{t("purchases.invoices.lines.account")}</th>
              <th>{t("purchases.invoices.lines.itemDetails")}</th><th>{t("purchases.invoices.lines.quantity")}</th>
              <th>{t("purchases.invoices.lines.unitPrice")}</th>
              <th>{t("purchases.invoices.lines.priceIncludesVat")}</th><th>{t("purchases.invoices.lines.discount")}</th>
              <th>{t("purchases.invoices.lines.totalWithVat")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {computedLines.map((l, idx) => {
              const selectedItem = items.find((i) => i.id === l.itemId);
              return (
                <tr key={idx}>
                  <td className="item-combo-cell">
                    <input
                      type="text"
                      value={l.description}
                      onChange={(e) => { clearItem(idx, e.target.value); setSearchText(e.target.value); setOpenDropdownIdx(idx); }}
                      onFocus={() => { setSearchText(l.description); setOpenDropdownIdx(idx); }}
                      onBlur={() => setTimeout(() => setOpenDropdownIdx((v) => (v === idx ? null : v)), 150)}
                      placeholder={t("purchases.invoices.lines.itemPlaceholder")}
                    />
                    {openDropdownIdx === idx && (
                      <div className="item-combo-dropdown">
                        {filtered(searchText).map((it) => (
                          <div key={it.id} className="item-combo-option" onMouseDown={() => pickItem(idx, it)}>
                            {it.name} <span className="note" style={{ margin: 0 }}>({it.code})</span>
                          </div>
                        ))}
                        {filtered(searchText).length === 0 && <div className="item-combo-option" style={{ cursor: "default" }}>{t("purchases.invoices.lines.noMatchingItems")}</div>}
                      </div>
                    )}
                  </td>
                  <td>
                    {selectedItem ? (
                      <span className="derived-account-note">{t("purchases.invoices.lines.derivedAccountNote")}</span>
                    ) : (
                      <AccountSearchSelect accounts={accounts} value={l.accountId} onChange={(accountId) => updateLine(idx, { accountId })} />
                    )}
                  </td>
                  <td>
                    {selectedItem?.type === "fixed_asset" && (
                      <div className="asset-line-fields">
                        <input type="number" min="1" value={l.usefulLifeYears} onChange={(e) => updateLine(idx, { usefulLifeYears: e.target.value })} placeholder={t("purchases.invoices.lines.usefulLifeYears")} />
                        <input type="number" min="0" value={l.salvageValue} onChange={(e) => updateLine(idx, { salvageValue: e.target.value })} placeholder={t("purchases.invoices.lines.salvageValue")} />
                      </div>
                    )}
                    {selectedItem && selectedItem.type !== "fixed_asset" && (
                      <select value={l.warehouseId} onChange={(e) => updateLine(idx, { warehouseId: e.target.value })}>
                        <option value="">{t("purchases.invoices.lines.chooseWarehouse")}</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    )}
                    {!selectedItem && "—"}
                  </td>
                  <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} /></td>
                  <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} placeholder="0.00" /></td>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={l.priceIncludesVat} onChange={(e) => updateLine(idx, { priceIncludesVat: e.target.checked })} />
                  </td>
                  <td><input type="number" className="amount-input" value={l.discountPct} onChange={(e) => updateLine(idx, { discountPct: e.target.value })} /></td>
                  <td className="num">{fmt2(l.total)}</td>
                  <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label" colSpan={7}>{t("purchases.invoices.lines.total")}</td>
              <td className="num">{fmt2(grandTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button className="btn-ghost" onClick={addLine}>{t("purchases.invoices.lines.addLine")}</button>

      <div className="preview-box">
        <div className="preview-row"><span>{t("purchases.invoices.lines.subtotal")}</span><strong>{fmt2(subtotal)} {currency}</strong></div>
        <div className="preview-row"><span>{t("purchases.invoices.lines.vat")}</span><strong>{fmt2(vatTotal)} {currency}</strong></div>
        <div className="preview-row net-row"><span>{t("purchases.invoices.lines.grandTotal")}</span><strong>{fmt2(grandTotal)} {currency}</strong></div>
      </div>
    </div>
  );
}
