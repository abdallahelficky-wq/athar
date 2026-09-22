import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { computeInvoiceLine } from "../shared/invoiceLine";
import { fmt2 } from "../../legacy/constants";
import { returnInvoiceLines } from "./returnInvoiceLines";
import { isSellableItem, emptySalesLine } from "./SalesInvoiceLinesEditor";
export default function ReturnLinesEditor({ lines, setLines, invoice, items, accounts, currency }) {
 const { t } = useTranslation();
 const [query, setQuery] = useState("");
 const choices = invoice ? returnInvoiceLines(invoice) : items.filter(isSellableItem).map((item) => ({ accountId: item.revenueAccountId || "", description: item.name, quantity: 1, unitPrice: Number(item.salePrice || 0), discountPct: 0, priceIncludesVat: true, vatApplicable: item.vatApplicable }));
 const matches = choices.filter((item) => item.description.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const add = (choice) => {
  if (choice.originalInvoiceLineId && lines.some((line) => line.originalInvoiceLineId === choice.originalInvoiceLineId)) return;
  setLines((old) => [...old.filter((line) => line.accountId || line.description), { ...choice }]); setQuery("");
 };
 const update = (index, patch) => setLines((old) => old.map((line, i) => i === index ? { ...line, ...patch } : line));
 const totals = lines.map(computeInvoiceLine).reduce((sum, line) => ({ subtotal: sum.subtotal + line.subtotal, vat: sum.vat + line.vat, total: sum.total + line.total }), { subtotal: 0, vat: 0, total: 0 });
 return <div>
  <label>{t("creditNote.search")}<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("creditNote.search")} /></label>
  {query && <div className="panel">{matches.length === 0 && <p>{t("creditNote.noItems")}</p>}{matches.map((item, i) => <button type="button" className="btn-ghost" key={i} onClick={() => add(item)}>{item.description} — {fmt2(item.unitPrice)}</button>)}</div>}
  <div className="lines-table-wrap"><table className="lines-table"><thead><tr>
   {["itemDescription", "account", "quantity", "unitPrice", "discount", "priceIncludesVat", "vatApplicable", "totalWithVat"].map((key) => <th key={key}>{t(`salesInvoices.form.lines.${key}`)}</th>)}<th />
  </tr></thead><tbody>{lines.map((line, index) => <tr key={line.originalInvoiceLineId || index}>
   <td><input value={line.description} readOnly={!!invoice} onChange={(e) => update(index, { description: e.target.value })} /></td>
   <td><select value={line.accountId} disabled={!!invoice} onChange={(e) => update(index, { accountId: e.target.value })}><option value="">—</option>{accounts.map((a) => <option value={a.id} key={a.id}>{a.code} — {a.name}</option>)}</select></td>
   <td><input type="number" min="0" step="0.0001" value={line.quantity} onChange={(e) => update(index, { quantity: e.target.value })} /></td>
   <td><input type="number" min="0" step="0.0001" readOnly={!!invoice} value={line.unitPrice} onChange={(e) => update(index, { unitPrice: e.target.value })} /></td>
   <td><input type="number" min="0" max="100" readOnly={!!invoice} value={line.discountPct} onChange={(e) => update(index, { discountPct: e.target.value })} /></td>
   <td><input type="checkbox" checked={line.priceIncludesVat} disabled={!!invoice} onChange={(e) => update(index, { priceIncludesVat: e.target.checked })} /></td>
   <td><input type="checkbox" checked={line.vatApplicable} disabled={!!invoice} onChange={(e) => update(index, { vatApplicable: e.target.checked })} /></td>
   <td>{fmt2(computeInvoiceLine(line).total)}</td><td><button type="button" className="btn-remove-line" aria-label={t("common.delete")} onClick={() => setLines((old) => old.filter((_, i) => i !== index))}>×</button></td>
  </tr>)}</tbody></table></div>
  {!invoice && <button type="button" className="btn-ghost" onClick={() => setLines((old) => [...old, emptySalesLine()])}>{t("salesInvoices.form.lines.addLine")}</button>}
  <div className="preview-box">{[["subtotal", totals.subtotal], ["vat", totals.vat], ["grandTotal", totals.total]].map(([key, amount]) => <div className="preview-row" key={key}><span>{t(`salesInvoices.form.lines.${key}`)}</span><strong>{fmt2(amount)} {currency}</strong></div>)}</div>
 </div>;
}
