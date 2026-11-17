import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listShippingZones, createShippingZone, updateShippingZone, deleteShippingZone,
  listStoreCoupons, createStoreCoupon, updateStoreCoupon, deleteStoreCoupon,
} from "../api/storeAdmin";
import { formatDate } from "../i18n/dateFormat";

const K = "settings.companyEdit.storeSettings";

/** مناطق الشحن: مدينة ورسوم توصيل شاملة الضريبة. كل تغيير يُحفَظ فوراً (جدول مستقل عن حقول الشركة). */
export function StoreShippingZonesPanel({ companyId }) {
  const { t } = useTranslation();
  const [zones, setZones] = useState([]);
  const [city, setCity] = useState("");
  const [fee, setFee] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => listShippingZones(companyId).then(setZones).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, [companyId]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const add = () => {
    if (!city.trim() || fee === "") return;
    run(async () => { await createShippingZone({ companyId, city: city.trim(), fee: Number(fee) }); setCity(""); setFee(""); });
  };

  return (
    <div className="store-settings-block">
      <p className="note">{t(`${K}.zonesNote`)}</p>
      <div className="form-grid">
        <label>{t(`${K}.zoneCity`)}<input type="text" maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>{t(`${K}.zoneFee`)}<input type="number" min="0" step="0.01" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
      </div>
      <button type="button" className="btn-ghost" onClick={add} disabled={busy || !city.trim() || fee === ""}>{t(`${K}.zoneAdd`)}</button>
      {error && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead><tr><th>{t(`${K}.zoneCity`)}</th><th>{t(`${K}.zoneFee`)}</th><th>{t(`${K}.status`)}</th><th></th></tr></thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.id}>
              <td>{z.city}</td>
              <td dir="ltr">{z.fee.toFixed(2)}</td>
              <td><span className={"status-badge" + (z.isActive ? " status-posted" : " status-neutral")}>{z.isActive ? t(`${K}.active`) : t(`${K}.inactive`)}</span></td>
              <td className="row-actions">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(() => updateShippingZone(z.id, { isActive: !z.isActive }))}>{z.isActive ? t(`${K}.deactivate`) : t(`${K}.activate`)}</button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t(`${K}.confirmDelete`, { name: z.city }))) run(() => deleteShippingZone(z.id)); }}>{t("common.delete")}</button>
              </td>
            </tr>
          ))}
          {zones.length === 0 && <tr><td className="empty" colSpan={4}>{t(`${K}.zonesEmpty`)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const emptyCoupon = { code: "", type: "percent", value: "", minOrderAmount: "", maxUses: "", expiresAt: "" };

/** كوبونات الخصم: نسبة أو مبلغ ثابت، بحد أدنى للطلب وعدد استخدامات وتاريخ انتهاء اختيارية. */
export function StoreCouponsPanel({ companyId }) {
  const { t, i18n } = useTranslation();
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(emptyCoupon);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => listStoreCoupons(companyId).then(setCoupons).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, [companyId]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const canAdd = form.code.trim().length >= 2 && Number(form.value) > 0;
  const add = () => run(async () => {
    await createStoreCoupon({
      companyId, code: form.code.trim(), type: form.type, value: Number(form.value),
      minOrderAmount: form.minOrderAmount === "" ? null : Number(form.minOrderAmount),
      maxUses: form.maxUses === "" ? null : Number(form.maxUses),
      // ينتهي آخر اليوم المختار
      expiresAt: form.expiresAt ? `${form.expiresAt}T23:59:59` : null,
    });
    setForm(emptyCoupon);
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="store-settings-block">
      <p className="note">{t(`${K}.couponsNote`)}</p>
      <div className="form-grid">
        <label>{t(`${K}.couponCode`)}<input type="text" dir="ltr" maxLength={40} value={form.code} placeholder="WELCOME10" onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} /></label>
        <label>{t(`${K}.couponType`)}
          <select value={form.type} onChange={(e) => set("type", e.target.value)}>
            <option value="percent">{t(`${K}.couponPercent`)}</option>
            <option value="fixed">{t(`${K}.couponFixed`)}</option>
          </select>
        </label>
        <label>{t(`${K}.couponValue`)}<input type="number" min="0" step="0.01" dir="ltr" value={form.value} onChange={(e) => set("value", e.target.value)} /></label>
        <label>{t(`${K}.couponMinOrder`)}<input type="number" min="0" step="0.01" dir="ltr" value={form.minOrderAmount} onChange={(e) => set("minOrderAmount", e.target.value)} /></label>
        <label>{t(`${K}.couponMaxUses`)}<input type="number" min="1" step="1" dir="ltr" value={form.maxUses} onChange={(e) => set("maxUses", e.target.value)} /></label>
        <label>{t(`${K}.couponExpires`)}<input type="date" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></label>
      </div>
      <button type="button" className="btn-ghost" onClick={add} disabled={busy || !canAdd}>{t(`${K}.couponAdd`)}</button>
      {error && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead><tr><th>{t(`${K}.couponCode`)}</th><th>{t(`${K}.couponValue`)}</th><th>{t(`${K}.couponMinOrder`)}</th><th>{t(`${K}.couponUsed`)}</th><th>{t(`${K}.couponExpires`)}</th><th>{t(`${K}.status`)}</th><th></th></tr></thead>
        <tbody>
          {coupons.map((c) => (
            <tr key={c.id}>
              <td dir="ltr">{c.code}</td>
              <td dir="ltr">{c.type === "percent" ? `${c.value}%` : c.value.toFixed(2)}</td>
              <td dir="ltr">{c.minOrderAmount == null ? "—" : c.minOrderAmount.toFixed(2)}</td>
              <td dir="ltr">{c.maxUses == null ? c.usedCount : `${c.usedCount} / ${c.maxUses}`}</td>
              <td>{c.expiresAt ? formatDate(c.expiresAt, i18n.language) : "—"}</td>
              <td><span className={"status-badge" + (c.isActive ? " status-posted" : " status-neutral")}>{c.isActive ? t(`${K}.active`) : t(`${K}.inactive`)}</span></td>
              <td className="row-actions">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(() => updateStoreCoupon(c.id, { isActive: !c.isActive }))}>{c.isActive ? t(`${K}.deactivate`) : t(`${K}.activate`)}</button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t(`${K}.confirmDelete`, { name: c.code }))) run(() => deleteStoreCoupon(c.id)); }}>{t("common.delete")}</button>
              </td>
            </tr>
          ))}
          {coupons.length === 0 && <tr><td className="empty" colSpan={7}>{t(`${K}.couponsEmpty`)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
