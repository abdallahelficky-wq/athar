import React, { useMemo, useRef, useState } from "react";
import { buildLeaseExpiryReportHtml, contractCity, filterReportContracts } from "./leaseReport";
import { LEASE_CATEGORIES, SAUDI_CITIES } from "./leaseLists";
import LeaseMultiSelect from "./LeaseMultiSelect";

/**
 * تبويب «التقرير»: تقرير انتهاء عقود الإيجار بنفس تصميم تقرير PDF، بفلاتر: تاريخ نهاية العقد، العلامة التجارية، المدينة،
 * التجديد التلقائي، وحالة العقد. يُعرَض في iframe معزول ويُطبع أو يُحفظ PDF من نافذة الطباعة.
 */
const STATUSES = ["active", "suspended", "stopped", "ended"];
const addYears = (day, n) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;
const DEFAULT_FILTERS = { endFrom: "", endTo: "", brands: [], cities: [], citiesExclude: false, autoRenew: "all", statuses: ["active"], direction: "lessee", categories: [] };

export default function LeaseReportView({ contracts, brands, companyName, today, t, i18n, fmtDay }) {
  const [f, setF] = useState(DEFAULT_FILTERS);
  const frameRef = useRef(null);

  // كل مدن المملكة متاحة للاختيار، والمدن المستخدمة في العقود (بعددها) أولاً
  const cityOptions = useMemo(() => {
    const count = new Map();
    for (const c of contracts) { const city = contractCity(c) || "none"; count.set(city, (count.get(city) || 0) + 1); }
    const used = [...count.keys()].filter((c) => c !== "none").sort((a, b) => a.localeCompare(b, "ar"));
    const rest = SAUDI_CITIES.filter((c) => !count.has(c));
    return [
      ...used.map((c) => ({ value: c, label: c, count: count.get(c) })),
      ...(count.has("none") ? [{ value: "none", label: t("leases.report.noCity"), count: count.get("none") }] : []),
      ...rest.map((c) => ({ value: c, label: c, count: 0 })),
    ];
  }, [contracts, t]);
  const brandOptions = useMemo(() => {
    const count = new Map();
    for (const c of contracts) count.set(c.brandId || "none", (count.get(c.brandId || "none") || 0) + 1);
    const list = brands.map((b) => ({ value: b.id, label: b.name, color: b.color || "#8896A4", count: count.get(b.id) || 0 }))
      .sort((a, b) => b.count - a.count);
    return [...list, { value: "none", label: t("leases.brands.none"), color: "#C5CDD5", count: count.get("none") || 0 }];
  }, [contracts, brands, t]);
  const categoryCount = useMemo(() => {
    const count = new Map();
    for (const c of contracts) count.set(c.category || "none", (count.get(c.category || "none") || 0) + 1);
    return count;
  }, [contracts]);
  const presetOf = (x) => (!x.endFrom && !x.endTo ? "any" : x.endFrom === today && x.endTo === addYears(today, 1) ? "12" : x.endFrom === today && x.endTo === addYears(today, 2) ? "24" : "custom");
  const applyPreset = (v) => {
    if (v === "any") setF({ ...f, endFrom: "", endTo: "" });
    else if (v === "12" || v === "24") setF({ ...f, endFrom: today, endTo: addYears(today, Number(v) / 12) });
  };
  const shown = useMemo(() => filterReportContracts(contracts, f), [contracts, f]);
  const brandName = (id) => (id === "none" ? t("leases.brands.none") : brands.find((b) => b.id === id)?.name || "");
  const cityName = (c) => (c === "none" ? t("leases.report.noCity") : c);

  const html = useMemo(() => {
    const oneBrand = f.brands.length === 1 && f.brands[0] !== "none" ? brandName(f.brands[0]) : "";
    const parts = [];
    if (f.endFrom || f.endTo) parts.push(t("leases.report.fEnd", { from: f.endFrom ? fmtDay(f.endFrom) : "…", to: f.endTo ? fmtDay(f.endTo) : "…" }));
    if (f.brands.length && !oneBrand) parts.push(`${t("leases.brands.label")}: ${f.brands.map(brandName).join("، ")}`);
    if (f.direction !== "all") parts.push(t(`leases.direction.${f.direction}`));
    if (f.categories.length) parts.push(`${t("leases.category.label")}: ${f.categories.map((k) => (k === "none" ? t("leases.category.none") : t(`leases.category.${k}`))).join("، ")}`);
    if (f.cities.length) parts.push(`${t("leases.property.city")}: ${f.citiesExclude ? t("leases.report.except") + " " : ""}${f.cities.map(cityName).join("، ")}`);
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

  return (
    <div className="panel ls-panel ls-report">
      <div className="ls-rfilters">
        <label className="ls-ff">
          <span className="ls-ff-label">{t("leases.direction.label")}</span>
          <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            <option value="lessee">{t("leases.direction.lesseeTab")}</option>
            <option value="lessor">{t("leases.direction.lessorTab")}</option>
            <option value="other">{t("leases.direction.otherTab")}</option>
            <option value="all">{t("leases.report.all")}</option>
          </select>
        </label>
        <LeaseMultiSelect label={t("leases.category.label")} allLabel={t("leases.category.all")} value={f.categories} onChange={(v) => setF({ ...f, categories: v })}
          options={[...LEASE_CATEGORIES, "none"].map((k) => ({ value: k, label: k === "none" ? t("leases.category.none") : t(`leases.category.${k}`), count: categoryCount.get(k) || 0 }))} />
        <LeaseMultiSelect label={t("leases.brands.label")} allLabel={t("leases.report.allBrands")} value={f.brands} onChange={(v) => setF({ ...f, brands: v })}
          options={brandOptions} searchable searchPlaceholder={t("leases.report.search")} />
        <LeaseMultiSelect label={t("leases.property.city")} allLabel={t("leases.report.allCities")} value={f.cities} onChange={(v) => setF({ ...f, cities: v })}
          options={cityOptions} searchable searchPlaceholder={t("leases.report.searchCity")} summaryPrefix={f.citiesExclude ? `${t("leases.report.except")} ` : ""}
          footer={(
            <label className="ls-ms-exclude"><input type="checkbox" checked={f.citiesExclude} onChange={(e) => setF({ ...f, citiesExclude: e.target.checked })} />{t("leases.report.cityExclude")}</label>
          )} />
        <label className="ls-ff">
          <span className="ls-ff-label">{t("leases.screen.renewal")}</span>
          <select value={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.value })}>
            <option value="all">{t("leases.report.all")}</option>
            <option value="yes">{t("leases.autoRenewShort")}</option>
            <option value="no">{t("leases.noAutoRenewShort")}</option>
          </select>
        </label>
        <LeaseMultiSelect label={t("leases.status")} allLabel={t("leases.report.allStatuses")} value={f.statuses} onChange={(v) => setF({ ...f, statuses: v })}
          options={STATUSES.map((st) => ({ value: st, label: t(`leases.contractStatus.${st}`) }))} />
        <label className="ls-ff">
          <span className="ls-ff-label">{t("leases.report.endRange")}</span>
          <select value={presetOf(f)} onChange={(e) => applyPreset(e.target.value)}>
            <option value="any">{t("leases.report.anyDate")}</option>
            <option value="12">{t("leases.report.next12")}</option>
            <option value="24">{t("leases.report.next24")}</option>
            <option value="custom">{t("leases.report.customRange")}</option>
          </select>
        </label>
        <label className="ls-ff">
          <span className="ls-ff-label">{t("leases.report.from")}</span>
          <input type="date" value={f.endFrom} onChange={(e) => setF({ ...f, endFrom: e.target.value })} />
        </label>
        <label className="ls-ff">
          <span className="ls-ff-label">{t("leases.report.to")}</span>
          <input type="date" value={f.endTo} onChange={(e) => setF({ ...f, endTo: e.target.value })} />
        </label>
        <div className="ls-ff ls-ff-reset">
          <span className="ls-ff-label">&nbsp;</span>
          <button type="button" className="ls-reset" onClick={() => setF(DEFAULT_FILTERS)}>{t("leases.report.reset")}</button>
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
