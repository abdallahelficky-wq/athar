import React, { useMemo, useRef, useState } from "react";
import { buildLeaseExpiryReportHtml, contractCity, filterReportContracts } from "./leaseReport";

/**
 * تبويب «التقرير»: تقرير انتهاء عقود الإيجار بنفس تصميم تقرير PDF، بفلاتر: تاريخ نهاية العقد، العلامة التجارية، المدينة،
 * التجديد التلقائي، وحالة العقد. يُعرَض في iframe معزول ويُطبع أو يُحفظ PDF من نافذة الطباعة.
 */
const STATUSES = ["active", "suspended", "stopped", "ended"];
const addYears = (day, n) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;

export default function LeaseReportView({ contracts, brands, companyName, today, t, i18n, fmtDay }) {
  const [f, setF] = useState({ endFrom: "", endTo: "", brands: [], cities: [], autoRenew: "all", statuses: ["active"] });
  const frameRef = useRef(null);
  const toggle = (key, value) => setF((x) => ({ ...x, [key]: x[key].includes(value) ? x[key].filter((v) => v !== value) : [...x[key], value] }));

  const cities = useMemo(() => {
    const set = new Map();
    for (const c of contracts) { const city = contractCity(c); set.set(city || "none", (set.get(city || "none") || 0) + 1); }
    return [...set.entries()].sort((a, b) => (a[0] === "none") - (b[0] === "none") || a[0].localeCompare(b[0], "ar"));
  }, [contracts]);
  const usedBrands = useMemo(() => {
    const count = new Map();
    for (const c of contracts) count.set(c.brandId || "none", (count.get(c.brandId || "none") || 0) + 1);
    const list = brands.filter((b) => count.has(b.id)).map((b) => ({ id: b.id, name: b.name, color: b.color, count: count.get(b.id) }));
    if (count.has("none")) list.push({ id: "none", name: t("leases.brands.none"), color: "#8896A4", count: count.get("none") });
    return list;
  }, [contracts, brands, t]);

  const shown = useMemo(() => filterReportContracts(contracts, f), [contracts, f]);
  const brandName = (id) => (id === "none" ? t("leases.brands.none") : brands.find((b) => b.id === id)?.name || "");
  const cityName = (c) => (c === "none" ? t("leases.report.noCity") : c);

  const html = useMemo(() => {
    const oneBrand = f.brands.length === 1 && f.brands[0] !== "none" ? brandName(f.brands[0]) : "";
    const parts = [];
    if (f.endFrom || f.endTo) parts.push(t("leases.report.fEnd", { from: f.endFrom ? fmtDay(f.endFrom) : "…", to: f.endTo ? fmtDay(f.endTo) : "…" }));
    if (f.brands.length && !oneBrand) parts.push(`${t("leases.brands.label")}: ${f.brands.map(brandName).join("، ")}`);
    if (f.cities.length) parts.push(`${t("leases.property.city")}: ${f.cities.map(cityName).join("، ")}`);
    if (f.autoRenew !== "all") parts.push(f.autoRenew === "yes" ? t("leases.autoRenewShort") : t("leases.noAutoRenewShort"));
    if (f.statuses.length && f.statuses.length < STATUSES.length) parts.push(`${t("leases.status")}: ${f.statuses.map((s) => t(`leases.contractStatus.${s}`)).join("، ")}`);
    return buildLeaseExpiryReportHtml({
      contracts: shown, today, companyName, fmtDay, t, lang: i18n.language?.startsWith("en") ? "en" : "ar",
      title: oneBrand ? t("leases.report.titleBrand", { brand: oneBrand }) : t("leases.report.title"),
      subtitle: t("leases.report.subtitle", { company: companyName }),
      filtersLine: parts.join(" · "),
    });
  }, [shown, f, today, companyName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ارتفاع الإطار = ارتفاع التقرير، فيُقرأ كاملاً بتمرير الصفحة نفسها؛ يُعاد القياس بعد تحميل الخط
  const fit = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const set = () => { if (frameRef.current) frameRef.current.style.height = `${doc.documentElement.scrollHeight + 4}px`; };
    set();
    doc.fonts?.ready?.then(set);
  };
  const print = () => frameRef.current?.contentWindow?.print();
  const Chip = ({ on, onClick, children, color }) => (
    <button type="button" className={`ls-fchip${on ? " is-on" : ""}`} style={color ? { "--c": color } : undefined} onClick={onClick}>{children}</button>
  );

  return (
    <div className="panel ls-panel ls-report">
      <div className="ls-rfilters">
        <div className="ls-rgroup">
          <span className="ls-rlabel">{t("leases.report.endRange")}</span>
          <div className="ls-rrow">
            <label>{t("leases.report.from")}<input type="date" value={f.endFrom} onChange={(e) => setF({ ...f, endFrom: e.target.value })} /></label>
            <label>{t("leases.report.to")}<input type="date" value={f.endTo} onChange={(e) => setF({ ...f, endTo: e.target.value })} /></label>
            <Chip on={f.endFrom === today && f.endTo === addYears(today, 1)} onClick={() => setF({ ...f, endFrom: today, endTo: addYears(today, 1) })}>{t("leases.report.next12")}</Chip>
            <Chip on={f.endFrom === today && f.endTo === addYears(today, 2)} onClick={() => setF({ ...f, endFrom: today, endTo: addYears(today, 2) })}>{t("leases.report.next24")}</Chip>
            <Chip on={!f.endFrom && !f.endTo} onClick={() => setF({ ...f, endFrom: "", endTo: "" })}>{t("leases.report.anyDate")}</Chip>
          </div>
        </div>
        <div className="ls-rgroup">
          <span className="ls-rlabel">{t("leases.brands.label")}</span>
          <div className="ls-rrow">
            <Chip on={!f.brands.length} onClick={() => setF({ ...f, brands: [] })}>{t("leases.report.allBrands")}</Chip>
            {usedBrands.map((b) => <Chip key={b.id} color={b.color} on={f.brands.includes(b.id)} onClick={() => toggle("brands", b.id)}>{b.name} <small>{b.count}</small></Chip>)}
          </div>
        </div>
        <div className="ls-rgroup">
          <span className="ls-rlabel">{t("leases.property.city")}</span>
          <div className="ls-rrow">
            <Chip on={!f.cities.length} onClick={() => setF({ ...f, cities: [] })}>{t("leases.report.allCities")}</Chip>
            {cities.map(([c, n]) => <Chip key={c} on={f.cities.includes(c)} onClick={() => toggle("cities", c)}>{cityName(c)} <small>{n}</small></Chip>)}
          </div>
        </div>
        <div className="ls-rgroup ls-rgroup-half">
          <span className="ls-rlabel">{t("leases.screen.renewal")}</span>
          <div className="ls-rrow">
            {["all", "yes", "no"].map((v) => <Chip key={v} on={f.autoRenew === v} onClick={() => setF({ ...f, autoRenew: v })}>{v === "all" ? t("leases.report.all") : v === "yes" ? t("leases.autoRenewShort") : t("leases.noAutoRenewShort")}</Chip>)}
          </div>
        </div>
        <div className="ls-rgroup ls-rgroup-half">
          <span className="ls-rlabel">{t("leases.status")}</span>
          <div className="ls-rrow">
            {STATUSES.map((s) => <Chip key={s} on={f.statuses.includes(s)} onClick={() => toggle("statuses", s)}>{t(`leases.contractStatus.${s}`)}</Chip>)}
          </div>
        </div>
      </div>
      <div className="ls-rbar">
        <span>{t("leases.report.count", { count: shown.length, total: contracts.length })}</span>
        <span className="ls-view-spacer" />
        <button type="button" className="ls-btn ls-btn-accent" onClick={print}>{t("leases.report.print")}</button>
      </div>
      <iframe ref={frameRef} title={t("leases.report.title")} className="ls-rframe" srcDoc={html} onLoad={fit} />
    </div>
  );
}
