import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/stationSetup";

const PRODUCTS = ["gasoline_91", "gasoline_95", "diesel"];
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * أسعار الوقود: سعر عام لكل منتج بتاريخ سريان يسري على كل محطات الشركة، وسعر خاص بمحطة يتغلّب عليه فيها
 * (محطات بأسعار مختلفة). البطاقات تعرض السعر الساري فعلاً للنطاق المختار: الخاص بالمحطة إن وُجد، وإلا العام. السجل إضافي فقط: لا يُعدَّل سعر في مكانه أبداً — الورديات المُرحَّلة قُيِّمت به — بل يُضاف سعر
 * جديد بتاريخ جديد. الحذف متاح فقط لسعر مجدول لم يسرِ بعد (تصحيح إدخال خاطئ).
 */
export default function FuelPricesTab({ companyId }) {
  const { t } = useTranslation();
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stations, setStations] = useState([]);
  const [form, setForm] = useState({ costCenterId: "", product: "gasoline_91", priceInclVat: "", effectiveFrom: todayIso() });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [list, st] = await Promise.all([api.listFuelPrices(companyId), api.listStations(companyId)]);
      setPrices(list);
      setStations(st.map((x) => ({ id: x.id, name: x.name })));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setLoading(true); load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setError(""); setMessage("");
    if (!(Number(form.priceInclVat) > 0)) { setError(t("fuelPrices.errPrice")); return; }
    setSaving(true);
    try {
      await api.createFuelPrice({ companyId, costCenterId: form.costCenterId || null, product: form.product, priceInclVat: Number(form.priceInclVat), effectiveFrom: form.effectiveFrom });
      setMessage(t("fuelPrices.added"));
      setForm((f) => ({ ...f, priceInclVat: "" }));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (price) => {
    if (!window.confirm(t("fuelPrices.deleteConfirm"))) return;
    setError("");
    try {
      await api.deleteFuelPrice(price.id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const day = (iso) => String(iso).slice(0, 10);
  const money = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  if (loading) return <div className="panel"><p className="note">…</p></div>;

  return (
    <div className="fuel-prices">
      {error && <p className="balance-bad" role="alert">{error}</p>}
      {message && <p className="note">{message}</p>}

      <div className="form-grid">
        <label>{t("fuelPrices.station")}
          <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
            <option value="">{t("fuelPrices.allStations")}</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div className="fuel-price-cards">
        {PRODUCTS.map((product) => {
          // السعر الساري للنطاق المختار: خاص بالمحطة إن وُجد، وإلا العام
          const scoped = (cc) => prices.filter((p) => p.product === product && (p.costCenterId || "") === cc);
          const own = form.costCenterId ? scoped(form.costCenterId) : [];
          const pool = own.some((p) => p.status !== "upcoming") ? own : scoped("");
          const current = pool.find((p) => p.status === "current");
          const next = [...own, ...scoped("")].filter((p) => p.status === "upcoming").sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))[0];
          return (
            <div className={`panel fuel-price-card ${current ? "" : "fuel-price-missing"}`} key={product}>
              <div className="fuel-price-product">{t(`stationSetup.products.${product}`)}</div>
              {current ? (
                <>
                  <div className="fuel-price-value" dir="ltr">{money(current.priceInclVat)} <span>{t("fuelPrices.currency")}</span></div>
                  <div className="note">{t("fuelPrices.inForceSince", { date: day(current.effectiveFrom) })}</div>
                  {form.costCenterId && <div className="note">{t(current.costCenterId ? "fuelPrices.stationPrice" : "fuelPrices.generalPrice")}</div>}
                </>
              ) : (
                <div className="fuel-price-value fuel-price-none">{t("fuelPrices.notSet")}</div>
              )}
              {next && <div className="note fuel-price-next">{t("fuelPrices.nextChange", { price: money(next.priceInclVat), date: day(next.effectiveFrom) })}</div>}
            </div>
          );
        })}
      </div>

      <div className="panel form-panel">
        <h3>{t("fuelPrices.addTitle")}</h3>
        <p className="note">{t("fuelPrices.note")}</p>
        <div className="form-grid">
          <label>{t("fuelPrices.product")}
            <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
              {PRODUCTS.map((p) => <option key={p} value={p}>{t(`stationSetup.products.${p}`)}</option>)}
            </select>
          </label>
          <label>{t("fuelPrices.price")}
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.priceInclVat} onChange={(e) => setForm({ ...form, priceInclVat: e.target.value })} />
          </label>
          <label>{t("fuelPrices.effectiveFrom")}
            <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          </label>
        </div>
        <button className="btn-primary" onClick={add} disabled={saving}>{t("fuelPrices.addBtn")}</button>
      </div>

      <div className="panel">
        <h3>{t("fuelPrices.historyTitle")}</h3>
        {prices.length === 0 ? (
          <p className="note">{t("fuelPrices.noPrices")}</p>
        ) : (
          <div className="lines-table-wrap">
            <table className="lines-table">
              <thead>
                <tr><th>{t("fuelPrices.station")}</th><th>{t("fuelPrices.product")}</th><th>{t("fuelPrices.price")}</th><th>{t("fuelPrices.effectiveFrom")}</th><th>{t("fuelPrices.status")}</th><th></th></tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <tr key={p.id} className={p.status === "current" ? "fuel-price-row-current" : ""}>
                    <td>{p.stationName || t("fuelPrices.allStations")}</td>
                    <td>{t(`stationSetup.products.${p.product}`)}</td>
                    <td dir="ltr">{money(p.priceInclVat)}</td>
                    <td dir="ltr">{day(p.effectiveFrom)}</td>
                    <td><span className={`status-badge fuel-price-status-${p.status}`}>{t(`fuelPrices.statuses.${p.status}`)}</span></td>
                    <td>{p.status === "upcoming" && <button className="btn-ghost btn-small" onClick={() => remove(p)}>{t("fuelPrices.deleteUpcoming")}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
