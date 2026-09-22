import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PrintShell } from "../../legacy/shared";
import { fmt2 } from "../../legacy/constants";
import { getItemCard } from "../../api/stockMovements";
import { routes } from "../../routes";

/**
 * كرت صنف للقراءة فقط (لا حقول قابلة للتعديل) — سجل حركاته مع رصيد متحرك، مبنيّ بالكامل من بيانات
 * StockMovement الموجودة أصلاً (راجع getItemCard بالخادم). لا يوجد "كرت صنف" حقيقي آخر في النظام؛
 * النافذة الموجودة أصلاً في ItemsTab.jsx (viewItem) بطاقة تفاصيل بسيطة بلا سجل حركات إطلاقاً.
 */
export default function ItemCardModal({ itemId, companyId, onClose }) {
  const { t, i18n } = useTranslation();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [card, setCard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const MOVEMENT_TYPE_LABEL = t("inventory.movementsTable.types", { returnObjects: true });
  const TYPE_META = t("inventory.typeMeta", { returnObjects: true });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getItemCard(itemId, { companyId, from: dateFrom || undefined, to: dateTo || undefined })
      .then((res) => !cancelled && setCard(res))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [itemId, companyId, dateFrom, dateTo]);

  const documentLink = (row) => {
    if (row.documentType === "sales_invoice" && row.documentNumber) {
      return <Link className="drill-link" to={routes.invoiceByNumber(row.documentNumber)}>{row.documentNumber}</Link>;
    }
    if (row.documentType === "purchase_invoice" && row.documentNumber) {
      return <Link className="drill-link" to={routes.purchases("invoices")}>{row.documentNumber}</Link>;
    }
    return MOVEMENT_TYPE_LABEL[row.type] || row.type;
  };

  if (error) {
    return (
      <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="unpost-confirm-box">
          <div className="modal-title-row">
            <h3>{t("inventory.itemCard.titleFailed")}</h3>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("common.close")}>×</button>
          </div>
          <p className="balance-bad">{error}</p>
          <div className="form-btn-group"><button className="btn-ghost" onClick={onClose}>{t("common.close")}</button></div>
        </div>
      </div>
    );
  }

  return (
    <PrintShell
      subtitle={t("inventory.itemCard.subtitle")}
      refNode={card ? <div>{card.item.code} — <strong>{card.item.name}</strong></div> : null}
      onClose={onClose}
    >
      <div className="no-print filter-bar" style={{ marginBottom: 14 }}>
        <label>{t("filters.dateFrom")}<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label>{t("filters.dateTo")}<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
      </div>

      {loading || !card ? <p className="empty">{t("salesInvoices.loading")}</p> : (
        <>
          <div className="voucher-meta">
            <div><span>{t("inventory.itemCard.type")}</span><strong>{TYPE_META[card.item.type] || card.item.type}</strong></div>
            <div><span>{t("inventory.items.view.unit")}</span><strong>{card.item.unit || "—"}</strong></div>
            <div><span>{t("inventory.itemCard.closingBalance")}</span><strong>{fmt2(card.closingBalance)}</strong></div>
          </div>
          <table className="ledger-table voucher-table">
            <thead>
              <tr>
                <th>{t("inventory.movementsTable.date")}</th>
                <th>{t("inventory.itemCard.document")}</th>
                <th>{t("inventory.movementsTable.location")}</th>
                <th>{t("inventory.itemCard.quantityIn")}</th>
                <th>{t("inventory.itemCard.quantityOut")}</th>
                <th>{t("inventory.itemCard.balance")}</th>
                <th>{t("inventory.itemCard.unitCost")}</th>
                <th>{t("inventory.movementsTable.note")}</th>
              </tr>
            </thead>
            <tbody>
              {Boolean(card.openingBalance) && (
                <tr>
                  <td className="foot-label" colSpan={5}>{t("statementOfAccount.openingBalance")}</td>
                  <td className="num strong">{fmt2(card.openingBalance)}</td>
                  <td colSpan={2}></td>
                </tr>
              )}
              {card.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date.slice(0, 10)}</td>
                  <td>{documentLink(row)}</td>
                  <td>{row.warehouseName}</td>
                  <td className="num">{row.quantityIn ? fmt2(row.quantityIn) : "—"}</td>
                  <td className="num">{row.quantityOut ? fmt2(row.quantityOut) : "—"}</td>
                  <td className="num strong">{fmt2(row.runningBalance)}</td>
                  <td className="num">{fmt2(row.unitCost)}</td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
              {card.rows.length === 0 && <tr><td className="empty" colSpan={8}>{t("inventory.movementsTable.empty")}</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td className="foot-label" colSpan={5}>{t("inventory.itemCard.closingBalance")}</td>
                <td className="num strong">{fmt2(card.closingBalance)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </PrintShell>
  );
}
