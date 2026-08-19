import React from "react";
import { useTranslation } from "react-i18next";
import { fmt2 } from "../../legacy/constants";

export default function StockMovementsTable({ movements, filterTypes, onRemove }) {
  const { t } = useTranslation();
  const TYPE_LABEL = t("inventory.movementsTable.types", { returnObjects: true });
  const filtered = movements.filter((m) => filterTypes.includes(m.type));
  return (
    <div className="panel">
      <table className="ledger-table">
        <thead>
          <tr>
            <th>{t("inventory.movementsTable.date")}</th><th>{t("inventory.movementsTable.item")}</th>
            <th>{t("inventory.movementsTable.location")}</th><th>{t("inventory.movementsTable.type")}</th>
            <th>{t("inventory.movementsTable.quantity")}</th><th>{t("inventory.movementsTable.note")}</th>
            {onRemove && <th></th>}
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.id}>
              <td>{m.date.slice(0, 10)}</td><td>{m.item?.name}</td><td>{m.warehouse?.name}</td>
              <td>{TYPE_LABEL[m.type]}</td><td className="num">{fmt2(m.quantity)}</td><td>{m.note || "—"}</td>
              {onRemove && <td><button className="btn-ghost" onClick={() => onRemove(m)}>{t("inventory.movementsTable.delete")}</button></td>}
            </tr>
          ))}
          {filtered.length === 0 && <tr><td className="empty" colSpan={onRemove ? 7 : 6}>{t("inventory.movementsTable.empty")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
