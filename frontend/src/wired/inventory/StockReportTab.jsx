import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStockReport } from "../../api/stockMovements";
import { fmt, fmt2 } from "../../legacy/constants";
import { getItemDisplayName, getUnitDisplayLabel } from "../shared/itemDisplayName";

export default function StockReportTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!companyId) return;
    getStockReport(companyId).then(setRows);
  }, [companyId]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div className="panel">
      <table className="ledger-table">
        <thead>
          <tr>
            <th>{t("inventory.stockReport.item")}</th><th>{t("inventory.stockReport.code")}</th>
            <th>{t("inventory.stockReport.location")}</th><th>{t("inventory.stockReport.balance")}</th>
            <th>{t("inventory.stockReport.costPrice")}</th><th>{t("inventory.stockReport.value")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.itemId}-${r.warehouseId}`}>
              <td>{getItemDisplayName(r, i18n.language)}</td><td>{r.itemCode}</td><td>{r.warehouseName}</td>
              <td className="num">{fmt2(r.quantity)} {getUnitDisplayLabel(r.unit, i18n.language)}</td>
              <td className="num">{r.valueTracked ? fmt2(r.costPrice) : <span className="note">{t("inventory.stockReport.notValueTracked")}</span>}</td>
              <td className="num strong">{r.valueTracked ? fmt(r.value) : <span className="note">{t("inventory.stockReport.notValueTracked")}</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="empty" colSpan={6}>{t("inventory.stockReport.empty")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
