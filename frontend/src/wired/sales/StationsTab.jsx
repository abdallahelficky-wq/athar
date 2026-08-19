import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCostCenters } from "../../api/costCenters";
import { listStationSales, createStationSale, deleteStationSale } from "../../api/stationSales";
import { fmt, fmt2 } from "../../legacy/constants";

export default function StationsTab({ companyId }) {
  const { t } = useTranslation();
  const [costCenters, setCostCenters] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [costCenterId, setCostCenterId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [shiftNote, setShiftNote] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listCostCenters().then((ccs) => {
      const scoped = ccs.filter((c) => !c.companyId || c.companyId === companyId);
      setCostCenters(scoped);
      if (scoped[0]) setCostCenterId((c) => c || scoped[0].id);
    });
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listStationSales(companyId).then(setSales).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!costCenterId || !Number(liters) || !Number(pricePerLiter)) return;
    try {
      await createStationSale({ companyId, costCenterId, date, liters: Number(liters), pricePerLiter: Number(pricePerLiter), shiftNote });
      setLiters(""); setPricePerLiter(""); setShiftNote("");
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (s) => {
    if (!window.confirm(t("sales.stations.confirmDelete"))) return;
    try {
      await deleteStationSale(s.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("sales.stations.station")}<select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t("sales.stations.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{t("sales.stations.liters")}<input type="number" value={liters} onChange={(e) => setLiters(e.target.value)} /></label>
          <label>{t("sales.stations.pricePerLiter")}<input type="number" step="0.01" value={pricePerLiter} onChange={(e) => setPricePerLiter(e.target.value)} /></label>
          <label className="memo-field">{t("sales.stations.shiftNote")}<input type="text" value={shiftNote} onChange={(e) => setShiftNote(e.target.value)} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!costCenterId || !Number(liters) || !Number(pricePerLiter)}>{t("sales.stations.save")}</button>
      </div>

      {loading ? <p className="empty">{t("sales.stations.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.stations.table.date")}</th><th>{t("sales.stations.table.station")}</th>
                <th>{t("sales.stations.table.liters")}</th><th>{t("sales.stations.table.pricePerLiter")}</th>
                <th>{t("sales.stations.table.total")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>{s.date.slice(0, 10)}</td><td>{s.costCenter?.name}</td>
                  <td className="num">{fmt2(s.liters)}</td><td className="num">{fmt2(s.pricePerLiter)}</td>
                  <td className="num">{fmt(s.liters * s.pricePerLiter)}</td>
                  <td><button className="btn-ghost" onClick={() => remove(s)}>{t("sales.stations.delete")}</button></td>
                </tr>
              ))}
              {sales.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.stations.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
