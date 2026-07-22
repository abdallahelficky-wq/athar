import React from "react";
import { fmt2 } from "../../legacy/constants";

const TYPE_LABEL = { in: "إدخال", out: "إخراج/إتلاف", issue: "صرف", transfer_out: "تحويل صادر", transfer_in: "تحويل وارد" };

export default function StockMovementsTable({ movements, filterTypes, onRemove }) {
  const filtered = movements.filter((m) => filterTypes.includes(m.type));
  return (
    <div className="panel">
      <table className="ledger-table">
        <thead><tr><th>التاريخ</th><th>الصنف</th><th>الموقع</th><th>النوع</th><th>الكمية</th><th>ملاحظة</th>{onRemove && <th></th>}</tr></thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.id}>
              <td>{m.date.slice(0, 10)}</td><td>{m.item?.name}</td><td>{m.warehouse?.name}</td>
              <td>{TYPE_LABEL[m.type]}</td><td className="num">{fmt2(m.quantity)}</td><td>{m.note || "—"}</td>
              {onRemove && <td><button className="btn-ghost" onClick={() => onRemove(m)}>حذف</button></td>}
            </tr>
          ))}
          {filtered.length === 0 && <tr><td className="empty" colSpan={onRemove ? 7 : 6}>لا توجد حركات بعد.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
