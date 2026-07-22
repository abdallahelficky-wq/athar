import React, { useEffect, useState } from "react";
import { getStockReport } from "../../api/stockMovements";
import { fmt, fmt2 } from "../../legacy/constants";

export default function StockReportTab({ companyId }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!companyId) return;
    getStockReport(companyId).then(setRows);
  }, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div className="panel">
      <table className="ledger-table">
        <thead><tr><th>الصنف</th><th>الكود</th><th>الموقع</th><th>الرصيد</th><th>سعر التكلفة</th><th>القيمة</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.itemId}-${r.warehouseId}`}>
              <td>{r.itemName}</td><td>{r.itemCode}</td><td>{r.warehouseName}</td>
              <td className="num">{fmt2(r.quantity)} {r.unit}</td><td className="num">{fmt2(r.costPrice)}</td>
              <td className="num strong">{fmt(r.value)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد أرصدة مخزون بعد.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
