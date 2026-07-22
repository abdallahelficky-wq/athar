import React, { useEffect, useState } from "react";
import { listItems } from "../../api/items";
import { listCostCenters } from "../../api/costCenters";
import { listStockMovements, getStockBalance, createTransferMovement, removeStockMovement } from "../../api/stockMovements";
import { fmt2 } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import StockMovementsTable from "./StockMovementsTable";

export default function TransferTab({ companyId, companies }) {
  const [items, setItems] = useState([]);
  const [allCostCenters, setAllCostCenters] = useState([]);
  const [movements, setMovements] = useState([]);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);

  const [itemId, setItemId] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toCompanyId, setToCompanyId] = useState(companyId);
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!companyId) return;
    listItems(companyId).then((its) => { setItems(its); if (its[0]) setItemId((v) => v || its[0].id); });
    listCostCenters().then(setAllCostCenters);
    setToCompanyId(companyId);
  }, [companyId]);

  const fromWarehouses = allCostCenters.filter((c) => !c.companyId || c.companyId === companyId);
  const toWarehouses = allCostCenters.filter((c) => !c.companyId || c.companyId === toCompanyId);
  const crossCompany = toCompanyId !== companyId;

  useEffect(() => { if (fromWarehouses[0]) setFromWarehouseId((v) => v || fromWarehouses[0].id); }, [allCostCenters, companyId]);
  useEffect(() => { if (toWarehouses[0]) setToWarehouseId(toWarehouses[0].id); }, [toCompanyId, allCostCenters]);

  const reload = () => {
    if (!companyId) return;
    listStockMovements(companyId).then(setMovements).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId]);

  useEffect(() => {
    if (!itemId || !fromWarehouseId) return;
    getStockBalance(itemId, fromWarehouseId).then((r) => setBalance(r.balance));
  }, [itemId, fromWarehouseId, movements]);

  const save = async () => {
    if (!itemId || !fromWarehouseId || !toWarehouseId || !toCompanyId || !Number(quantity)) return;
    try {
      await createTransferMovement({ itemId, fromWarehouseId, toWarehouseId, toCompanyId, quantity: Number(quantity), date });
      setQuantity("");
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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الصنف<select value={itemId} onChange={(e) => setItemId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>من موقع (المصدر)<select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>{fromWarehouses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>الشركة المستقبلة<select value={toCompanyId} onChange={(e) => setToCompanyId(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>إلى موقع (الوجهة)<select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>{toWarehouses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>الكمية<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {itemId && fromWarehouseId && (
          <p className="note">
            الرصيد المتاح بالمصدر: <strong>{fmt2(balance)}</strong>
            {crossCompany && " — تحويل بين شركتين مختلفتين، سيُرحّل عبر حساب جاري بين الشركات."}
          </p>
        )}
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!itemId || !fromWarehouseId || !toWarehouseId || !Number(quantity) || Number(quantity) > balance}>تنفيذ التحويل</button>
      </div>

      <StockMovementsTable movements={movements} filterTypes={["transfer_out", "transfer_in"]} onRemove={setRemoveTarget} />
      {removeTarget && <UnpostModal title="حذف عملية التحويل" onCancel={() => setRemoveTarget(null)} onConfirm={doRemove} />}
    </div>
  );
}
