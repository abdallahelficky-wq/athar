import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listItems } from "../../api/items";
import { listWarehouses } from "../../api/warehouses";
import { listStockMovements, getStockBalance, createIssueMovement, removeStockMovement } from "../../api/stockMovements";
import { DEPARTMENTS, fmt2 } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import StockMovementsTable from "./StockMovementsTable";

export default function IssueTab({ companyId }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [movements, setMovements] = useState([]);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);

  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listItems(companyId).then((its) => { setItems(its); if (its[0]) setItemId((v) => v || its[0].id); });
    listWarehouses(companyId).then((whs) => {
      setWarehouses(whs);
      if (whs[0]) setWarehouseId((v) => v || whs[0].id);
    });
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    listStockMovements(companyId).then(setMovements).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId]);

  useEffect(() => {
    if (!itemId || !warehouseId) return;
    getStockBalance(itemId, warehouseId).then((r) => setBalance(r.balance));
  }, [itemId, warehouseId, movements]);

  const save = async () => {
    if (!itemId || !warehouseId || !Number(quantity)) return;
    try {
      await createIssueMovement({ itemId, warehouseId, department, quantity: Number(quantity), date, note });
      setQuantity(""); setNote("");
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doRemove = async (pin) => {
    await removeStockMovement(removeTarget.id, pin);
    setRemoveTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("inventory.issue.item")}<select value={itemId} onChange={(e) => setItemId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>{t("inventory.issue.warehouse")}<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>{t("inventory.issue.department")}<select value={department} onChange={(e) => setDepartment(e.target.value)}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>{t("inventory.issue.quantity")}<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>{t("inventory.issue.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">{t("inventory.issue.note")}<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {itemId && warehouseId && (
          <p className="note">
            {t("inventory.issue.availableBalance")} <strong>{fmt2(balance)}</strong>
            {Number(quantity) > balance && <span className="balance-bad"> {t("inventory.issue.exceedsBalance")}</span>}
          </p>
        )}
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!itemId || !warehouseId || !Number(quantity) || Number(quantity) > balance}>{t("inventory.issue.issueBtn")}</button>
      </div>

      <StockMovementsTable movements={movements} filterTypes={["issue"]} onRemove={setRemoveTarget} />
      {removeTarget && <UnpostModal title={t("inventory.issue.removeMovementTitle")} onCancel={() => setRemoveTarget(null)} onConfirm={doRemove} />}
    </div>
  );
}
