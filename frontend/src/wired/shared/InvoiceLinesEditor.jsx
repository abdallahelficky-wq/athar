import React from "react";
import { useTranslation } from "react-i18next";
import { computeInvoiceLine } from "./invoiceLine";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "./AccountSearchSelect";

export const emptyInvoiceLine = () => ({ accountId: "", description: "", quantity: 1, unitPrice: "", discountPct: 0, priceIncludesVat: true });

/** محرر أسطر فاتورة/عرض سعر/مردود — مشترك بين المبيعات والمشتريات */
export default function InvoiceLinesEditor({ lines, setLines, accounts, showVatToggle = true }) {
  const { t } = useTranslation();
  const computedLines = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computedLines.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  const currency = t("common.currency");

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyInvoiceLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  return (
    <div>
      <div className="lines-table-wrap">
        <table className="lines-table">
          <thead>
            <tr>
              <th>{t("common.invoiceLines.account")}</th><th>{t("common.invoiceLines.description")}</th>
              <th>{t("common.invoiceLines.quantity")}</th><th>{t("common.invoiceLines.unitPrice")}</th>
              {showVatToggle && <th>{t("common.invoiceLines.priceIncludesVat")}</th>}
              <th>{t("common.invoiceLines.discount")}</th><th>{t("common.invoiceLines.totalWithVat")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {computedLines.map((l, idx) => (
              <tr key={idx}>
                <td>
                  <AccountSearchSelect accounts={accounts} value={l.accountId} onChange={(accountId) => updateLine(idx, "accountId", accountId)} />
                </td>
                <td><input type="text" value={l.description} onChange={(e) => updateLine(idx, "description", e.target.value)} placeholder={t("common.invoiceLines.descriptionPlaceholder")} /></td>
                <td><input type="number" className="amount-input" value={l.quantity} onChange={(e) => updateLine(idx, "quantity", e.target.value)} /></td>
                <td><input type="number" className="amount-input" value={l.unitPrice} onChange={(e) => updateLine(idx, "unitPrice", e.target.value)} placeholder="0.00" /></td>
                {showVatToggle && (
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={l.priceIncludesVat} onChange={(e) => updateLine(idx, "priceIncludesVat", e.target.checked)} />
                  </td>
                )}
                <td><input type="number" className="amount-input" value={l.discountPct} onChange={(e) => updateLine(idx, "discountPct", e.target.value)} /></td>
                <td className="num">{fmt2(l.total)}</td>
                <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>✕</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label" colSpan={showVatToggle ? 6 : 5}>{t("common.invoiceLines.total")}</td>
              <td className="num">{fmt2(grandTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button className="btn-ghost" onClick={addLine}>{t("common.invoiceLines.addLine")}</button>

      <div className="preview-box">
        <div className="preview-row"><span>{t("common.invoiceLines.subtotal")}</span><strong>{fmt2(subtotal)} {currency}</strong></div>
        <div className="preview-row"><span>{t("common.invoiceLines.vat")}</span><strong>{fmt2(vatTotal)} {currency}</strong></div>
        <div className="preview-row net-row"><span>{t("common.invoiceLines.grandTotal")}</span><strong>{fmt2(grandTotal)} {currency}</strong></div>
      </div>
    </div>
  );
}
