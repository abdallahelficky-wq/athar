import React, { useEffect, useState } from "react";
import { listItems } from "../../api/items";
import { listCostCenters } from "../../api/costCenters";
import { listStockMovements, getStockBalance, createInOutMovement, removeStockMovement } from "../../api/stockMovements";
import { fmt2 } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import StockMovementsTable from "./StockMovementsTable";

export default function StockInOutTab({ companyId }) {
  const [items, setItems] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [movements, setMovements] = useState([]);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);

  const [type, setType] = useState("in");
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listItems(companyId).then((its) => { setItems(its); if (its[0]) setItemId((v) => v || its[0].id); });
    listCostCenters().then((ccs) => {
      const scoped = ccs.filter((c) => !c.companyId || c.companyId === companyId);
      setCostCenters(scoped);
      if (scoped[0]) setWarehouseId((v) => v || scoped[0].id);
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
      await createInOutMovement({ type, itemId, warehouseId, quantity: Number(quantity), date, note });
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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الحركة<select value={type} onChange={(e) => setType(e.target.value)}><option value="in">إضافة مخزون</option><option value="out">حذف / إتلاف مخزون</option></select></label>
          <label>الصنف<select value={itemId} onChange={(e) => setItemId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>الموقع / المخزن<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>الكمية<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">ملاحظة<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {itemId && warehouseId && <p className="note">الرصيد الحالي لهذا الصنف في هذا الموقع: <strong>{fmt2(balance)}</strong></p>}
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!itemId || !warehouseId || !Number(quantity)}>حفظ الحركة</button>
      </div>

      <StockMovementsTable movements={movements} filterTypes={["in", "out"]} onRemove={setRemoveTarget} />
      {removeTarget && <UnpostModal title="حذف الحركة المخزنية" onCancel={() => setRemoveTarget(null)} onConfirm={doRemove} />}
    </div>
  );
}
