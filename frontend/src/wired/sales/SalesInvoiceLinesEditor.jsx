import React, { useState } from "react";
import { computeInvoiceLine } from "../shared/invoiceLine";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "../shared/AccountSearchSelect";

export const emptySalesLine = () => ({
  accountId: "", itemId: "", description: "", quantity: 1, unitPrice: "",
  discountPct: 0, priceIncludesVat: true, vatApplicable: true,
});

/** الأنواع القابلة للبيع عبر فاتورة مبيعات — يطابق نفس القاعدة في salesInvoices.service.ts (resolveLineAccounts). */
export function isSellableItem(item) {
  if (item.type === "expense" || item.type === "fixed_asset") return false;
  if (item.type === "raw_material") return item.allowDirectSale === true;
  return true;
}

/**
 * محرر أسطر فاتورة المبيعات — نسخة مخصَّصة من InvoiceLinesEditor المشترك (المستخدَم أيضاً
 * في المشتريات) تضيف حقل "الصنف" كقائمة بحث تُقترح منها الأصناف القابلة للبيع الفعلية
 * لهذه الشركة، مع خيار "+ إضافة صنف جديد باسم ..." يفتح نافذة فرعية. لم يُعدَّل المكوّن
 * المشترك نفسه حتى لا يتأثر منطق المشتريات (خارج نطاق هذا الطلب).
 */
export default function SalesInvoiceLinesEditor({ lines, setLines, accounts, items, onRequestNewItem }) {
  const sellableItems = items.filter(isSellableItem);
  const [openDropdownIdx, setOpenDropdownIdx] = useState(null);
  const [searchText, setSearchText] = useState("");

  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;

  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptySalesLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const pickItem = (idx, item) => {
    updateLine(idx, {
      itemId: item.id,
      description: item.name,
      accountId: item.revenueAccountId,
      unitPrice: item.salePrice != null ? Number(item.salePrice) : 0,
      vatApplicable: item.vatApplicable,
    });
    setOpenDropdownIdx(null);
  };

  const filtered = (text) => sellableItems.filter((it) => !text || it.name.includes(text));

  return (
    <div>
      <div className="lines-table-wrap">
        <table className="lines-table">
          <thead>
            <tr>
              <th>الصنف/الوصف</th><th>الحساب</th><th>الكمية</th><th>سعر الوحدة</th>
              <th>شامل الضريبة؟</th><th>خاضع للضريبة؟</th><th>خصم %</th><th>الإجمالي شامل الضريبة</th><th></th>
            </tr>
          </thead>
          <tbody>
            {computedLines.map((l, idx) => (
              <tr key={idx}>
                <td className="item-combo-cell">
                  <input
                    type="text"
                    value={l.description}
                    onChange={(e) => { updateLine(idx, { description: e.target.value, itemId: "" }); setSearchText(e.target.value); setOpenDropdownIdx(idx); }}
                    onFocus={() => { setSearchText(l.description); setOpenDropdownIdx(idx); }}
                    onBlur={() => setTimeout(() => setOpenDropdownIdx((v) => (v === idx ? null : v)), 150)}
                    placeholder="اكتب اسم الصنف أو وصفاً حراً"
                  />
                  {openDropdownIdx === idx && (
                    <div className="item-combo-dropdown">
                      {filtered(searchText).map((it) => (
                        <div key={it.id} className="item-combo-option" onMouseDown={() => pickItem(idx, it)}>
                          {it.name} <span className="note" style={{ margin: 0 }}>({fmt2(Number(it.salePrice || 0))} ر.س)</span>
                        </div>
                      ))}
                      <div
                        className="item-combo-option item-combo-new"
                        onMouseDown={() => { setOpenDropdownIdx(null); onRequestNewItem(idx, searchText); }}
                      >
                        + إضافة صنف جديد {searchText ? `باسم "${searchText}"` : ""}
                      </div>
                    </div>
                  )}
                </td>
                <td>
                  <AccountSearchSelect accounts={accounts} value={l.accountId} onChange={(accountId) => updateLine(idx, { accountId })} />
                </td>
                <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} /></td>
                <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} placeholder="0.00" /></td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={l.priceIncludesVat} onChange={(e) => updateLine(idx, { priceIncludesVat: e.target.checked })} />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={l.vatApplicable} onChange={(e) => updateLine(idx, { vatApplicable: e.target.checked })} />
                </td>
                <td><input type="number" className="amount-input" value={l.discountPct} onChange={(e) => updateLine(idx, { discountPct: e.target.value })} /></td>
                <td className="num">{fmt2(l.total)}</td>
                <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>✕</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label" colSpan={7}>الإجمالي</td>
              <td className="num">{fmt2(grandTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>

      <div className="preview-box">
        <div className="preview-row"><span>الإجمالي قبل الضريبة</span><strong>{fmt2(subtotal)} ر.س</strong></div>
        <div className="preview-row"><span>ضريبة القيمة المضافة (15٪)</span><strong>{fmt2(vatTotal)} ر.س</strong></div>
        <div className="preview-row net-row"><span>الإجمالي شامل الضريبة</span><strong>{fmt2(grandTotal)} ر.س</strong></div>
      </div>
    </div>
  );
}
