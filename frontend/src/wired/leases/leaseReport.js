/**
 * تقرير «انتهاء عقود الإيجار» — نفس تصميم تقرير PDF المُعَد يدوياً (رأس أخضر، مؤشرات، بطاقات عاجلة، مسار زمني، جدول ملوّن)،
 * يُبنى هنا من عقود الشركة بعد الفلترة ويُعرَض في iframe ويُطبع/يُحفظ PDF من المتصفح.
 * دالة نقية: تأخذ العقود المفلترة واليوم وتُرجع HTML كاملاً. كل النصوص من t (مفاتيح leases.report.*).
 */

const DAY = 86400000;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (from, to) => Math.round((ms(to) - ms(from)) / DAY);

/** شريحة العقد حسب قرب نهايته: منتهٍ / خلال 12 شهراً / خلال 24 شهراً / أبعد */
export function endTone(endDate, today) {
  const d = daysBetween(today, endDate);
  if (d < 0) return "past";
  if (d <= 365) return "red";
  if (d <= 730) return "amber";
  return "green";
}

export const contractCity = (c) => (c.propertyDetails?.city || "").trim();

/** فلترة العقود — نفس المنطق للشاشة والتقرير */
export function filterReportContracts(contracts, f) {
  return contracts.filter((c) => {
    if (f.statuses?.length && !f.statuses.includes(c.status || "active")) return false;
    if (f.endFrom && c.endDate < f.endFrom) return false;
    if (f.endTo && c.endDate > f.endTo) return false;
    if (f.direction && f.direction !== "all" && (c.direction || "lessee") !== f.direction) return false;
    if (f.categories?.length && !f.categories.includes(c.category || "none")) return false;
    if (f.brands?.length && !f.brands.includes(c.brandId || "none")) return false;
    // المدن: تضمين المحدد، أو استبعاده (citiesExclude) — مثل «خارج جدة»
    if (f.cities?.length && f.cities.includes(contractCity(c) || "none") === !!f.citiesExclude) return false;
    if (f.autoRenew === "yes" && !c.autoRenew) return false;
    if (f.autoRenew === "no" && c.autoRenew) return false;
    return true;
  }).sort((a, b) => a.endDate.localeCompare(b.endDate) || a.title.localeCompare(b.title, "ar"));
}

export function buildLeaseExpiryReportHtml({ contracts, today, companyName, title, subtitle, filtersLine, t, fmtDay, lang = "ar" }) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const side = dir === "rtl" ? "right" : "left";
  const rows = contracts.map((c) => {
    const left = daysBetween(today, c.endDate);
    const mapUrl = /^https?:\/\/\S+$/i.test(c.propertyDetails?.mapUrl || "") ? c.propertyDetails.mapUrl : "";
    return { ...c, left, monthsLeft: Math.max(0, Math.round(left / 30.44)), tone: endTone(c.endDate, today), city: contractCity(c), mapUrl };
  });
  const live = rows.filter((r) => r.left >= 0);
  const within = (a, b) => live.filter((r) => r.left > a && r.left <= b).length;
  const urgent = rows.filter((r) => r.left <= 365);
  const nearest = live[0];
  const autoCount = rows.filter((r) => r.autoRenew).length;

  const remaining = (r) => (r.left < 0 ? t("leases.report.endedAgo", { count: -r.left }) : r.left < 60 ? t("leases.report.daysLeft", { count: r.left }) : t("leases.report.monthsLeft", { count: r.monthsLeft }));
  const deadline = (r) => (r.noticeDeadline ? fmtDay(r.noticeDeadline) : "—");
  const brandChip = (r) => (r.brandName ? `<span class="brand" style="--b:${esc(r.brandColor || "#0D4A31")}">${esc(r.brandName)}</span>` : "—");

  // --- المسار الزمني: من بداية سنة اليوم حتى أبعد نهاية (حدّ 8 سنوات) ---
  const y0 = Number(today.slice(0, 4));
  const maxEnd = live.reduce((m, r) => (r.endDate > m ? r.endDate : m), today);
  const y1 = Math.min(Math.max(Number(maxEnd.slice(0, 4)) + 1, y0 + 2), y0 + 8);
  const t0 = ms(`${y0}-01-01`);
  const t1 = ms(`${y1}-01-01`);
  const pos = (d) => Math.min(100, Math.max(0, ((ms(d) - t0) / (t1 - t0)) * 100));
  const years = [];
  for (let y = y0; y < y1; y += 1) years.push(y);
  const todayPos = pos(today);
  const ganttRows = live.slice(0, 40).map((r) => {
    const end = pos(r.endDate);
    const width = Math.max(end - todayPos, 0.6);
    const nd = r.noticeDeadline && r.noticeDeadline >= today ? `<div class="nd" style="${side}:${pos(r.noticeDeadline).toFixed(2)}%" title="${esc(t("leases.report.decisionBy"))}"></div>` : "";
    return `<div class="grow"><div class="gname" title="${esc(r.title)}">${esc(r.title)}</div><div class="gtrack"><div class="bar ${r.tone}" style="${side}:${todayPos.toFixed(2)}%;width:${width.toFixed(2)}%"></div><span class="blbl" style="${side}:${Math.min(end + 0.8, 88).toFixed(2)}%">${esc(fmtDay(r.endDate))}</span>${nd}</div></div>`;
  }).join("");

  const ucard = (r) => `<div class="ucard ${r.left < 0 ? "past" : r.autoRenew ? "auto" : ""}"><div class="uhead"><b>${esc(r.title)}</b><span class="pill ${r.autoRenew ? "p-auto" : "p-no"}">${esc(r.autoRenew ? t("leases.autoRenewShort") : t("leases.noAutoRenewShort"))}</span></div>
<div class="umeta">${r.brandName ? `${brandChip(r)} ` : ""}${r.city ? `<span>${esc(r.city)}</span>` : ""}${r.mapUrl ? `<a class="map" href="${esc(r.mapUrl)}" target="_blank" rel="noopener noreferrer">📍</a>` : ""}${r.counterparty ? `<span>${esc(r.counterparty)}</span>` : ""}</div>
<div class="udates"><div><span>${esc(t("leases.endDate"))}</span><b>${esc(fmtDay(r.endDate))}</b></div><div><span>${esc(t("leases.report.decisionBy"))}</span><b>${esc(deadline(r))}</b></div><div><span>${esc(t("leases.report.remaining"))}</span><b>${esc(remaining(r))}</b></div></div>
<div class="uact">${esc(r.left < 0 ? t("leases.report.actEnded") : r.autoRenew ? t("leases.report.actAuto", { date: deadline(r) }) : t("leases.report.actNoAuto"))}</div></div>`;

  const tableRows = rows.map((r, i) => `<tr class="t-${r.tone}"><td>${i + 1}</td><td><b>${esc(r.title)}</b>${r.contractNumber ? `<div class="sub">${esc(r.contractNumber)}</div>` : ""}</td><td>${esc(r.category ? t(`leases.category.${r.category}`) : "—")}</td><td>${brandChip(r)}</td><td>${esc(r.city || "—")}${r.mapUrl ? ` <a class="map" href="${esc(r.mapUrl)}" target="_blank" rel="noopener noreferrer">📍</a>` : ""}</td><td>${esc(r.counterparty || "—")}</td><td>${esc(fmtDay(r.startDate))}</td><td><b>${esc(fmtDay(r.endDate))}</b></td><td><span class="mpill m-${r.tone}">${esc(remaining(r))}</span></td><td class="${r.autoRenew ? "yes" : "no"}">${esc(r.autoRenew ? t("leases.report.yes") : t("leases.report.no"))}</td><td>${esc(deadline(r))}</td><td>${esc(t(`leases.contractStatus.${r.status || "active"}`))}</td></tr>`).join("");

  const lead = nearest
    ? t("leases.report.lead", { title: nearest.title, date: fmtDay(nearest.endDate), deadline: deadline(nearest), count: within(-1, 365) })
    : t("leases.report.leadNone");

  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:10mm 0 12mm}
*{box-sizing:border-box} body{margin:0;font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#1c2a38;font-size:10.5pt;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hero{background:linear-gradient(125deg,#083524,#0D4A31 40%,#1B8354 80%,#0E8F8A);color:#fff;padding:12mm 14mm 11mm;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;width:90mm;height:90mm;border-radius:50%;left:-25mm;top:-40mm;background:radial-gradient(circle,rgba(201,154,59,.2),transparent 70%)}
.hero .tag{display:inline-block;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:99px;padding:1mm 4mm;font-size:9pt;margin-bottom:3mm}
.hero h1{margin:0 0 2mm;font-size:22pt;font-weight:700} .hero p{margin:0;font-size:10.5pt;opacity:.92;line-height:1.8}
.hero .filters{margin-top:3mm;font-size:8.5pt;opacity:.85}
.wrap{padding:0 14mm 8mm}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin:-6mm 0 6mm;position:relative;z-index:2}
.kpi{background:#fff;border-radius:4mm;padding:4mm 5mm;box-shadow:0 1.5mm 5mm rgba(16,32,46,.12);border-top:1.4mm solid var(--k)}
.kpi span{display:block;font-size:9pt;color:#5B6B7B;font-weight:600} .kpi b{font-size:22pt;color:var(--k);font-weight:700;line-height:1.2} .kpi small{display:block;font-size:8pt;color:#7A8896}
h2{font-size:14pt;color:#0D4A31;margin:7mm 0 3mm;display:flex;align-items:center;gap:2.5mm;break-after:avoid} h2:before{content:"";width:2mm;height:6mm;border-radius:1mm;background:#C99A3B}
.lead{background:#E8F6EE;border-inline-start:1.5mm solid #1B8354;border-radius:2.5mm;padding:3.5mm 5mm;line-height:1.9}
.ucards{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.ucard{border:1px solid #F0CFC6;background:#FDF5F2;border-radius:3.5mm;padding:4mm;border-top:1.2mm solid #A8432B;break-inside:avoid}
.ucard.auto{border-color:#F0DDB6;background:#FDF8EE;border-top-color:#B7791F} .ucard.past{border-color:#D9DEE3;background:#F5F7F9;border-top-color:#6B7785}
.uhead{display:flex;justify-content:space-between;align-items:center;gap:2mm;margin-bottom:1.5mm} .uhead b{font-size:12pt}
.umeta{display:flex;gap:2mm;flex-wrap:wrap;font-size:8.5pt;color:#5B6B7B;margin-bottom:2mm} .umeta span:not(.brand){background:#fff;border-radius:99px;padding:.3mm 2.5mm}
.pill{font-size:8pt;padding:.8mm 3mm;border-radius:99px;font-weight:600;white-space:nowrap} .p-auto{background:#F7E6C4;color:#7A5212} .p-no{background:#F6D9D1;color:#8A2F1B}
.udates{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;background:#fff;border-radius:2.5mm;padding:2.5mm}
.udates span{display:block;font-size:7.5pt;color:#7A8896} .udates b{font-size:10pt}
.uact{margin-top:2.5mm;font-size:9pt;font-weight:600;color:#4A5A6A}
.brand{display:inline-block;padding:.3mm 2.5mm;border-radius:99px;font-size:8pt;font-weight:700;color:#fff;background:var(--b)}
.gantt{border:1px solid #E1E7ED;border-radius:3.5mm;padding:4mm 4mm 3mm;background:#FBFCFD;position:relative}
.gantt{--gn:38mm} .gaxis,.grow{display:grid;grid-template-columns:var(--gn) 1fr;align-items:center} .gaxis .gtrack{height:6mm} .grow{height:6.6mm;break-inside:avoid}
.gname{font-size:8.4pt;font-weight:600;padding-inline-end:2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gtrack{position:relative;height:100%} .grow .gtrack:before{content:"";position:absolute;inset:50% 0 auto;border-top:1px dashed #E1E7ED}
.ylab{position:absolute;top:0;transform:translateX(${dir === "rtl" ? "50%" : "-50%"});font-size:8pt;color:#7A8896;font-weight:700}
.yline{position:absolute;top:6mm;bottom:0;border-${side}:1px solid #E3E8ED}
.today{position:absolute;top:0;bottom:0;border-${side}:.6mm solid #C99A3B} .today span{position:absolute;${side}:1mm;top:0;font-size:7.5pt;color:#9A7020;font-weight:700;white-space:nowrap}
.bar{position:absolute;top:1.3mm;height:4mm;border-radius:2mm} .bar.red{background:linear-gradient(90deg,#D9664A,#A8432B)} .bar.amber{background:linear-gradient(90deg,#E0A848,#B7791F)} .bar.green{background:linear-gradient(90deg,#3CB27A,#1B8354)}
.blbl{position:absolute;top:1.1mm;font-size:7.3pt;font-weight:700;color:#344454;white-space:nowrap}
.nd{position:absolute;top:.6mm;width:2.4mm;height:2.4mm;margin-${side}:-1.2mm;border-radius:50%;background:#fff;border:.6mm solid #083524}
.legend{display:flex;gap:5mm;flex-wrap:wrap;font-size:8.3pt;color:#4A5A6A;margin-top:3mm} .legend i{display:inline-block;width:6mm;height:2.6mm;border-radius:1.3mm;margin-inline-end:1.5mm;vertical-align:middle}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:8.3pt;border:1px solid #E1E7ED;border-radius:3mm;overflow:hidden}
th{background:#0D4A31;color:#fff;font-weight:600;padding:2.4mm 2mm;text-align:start;font-size:8.6pt} thead{display:table-header-group}
td{padding:1.5mm 2mm;border-bottom:1px solid #EEF2F5;vertical-align:middle} tr{break-inside:avoid} tr:nth-child(even) td{background:#F8FAFB}
tr td:first-child{color:#7A8896;width:6mm;text-align:center;border-${side}:1.2mm solid transparent} tr.t-red td:first-child{border-${side}-color:#A8432B} tr.t-amber td:first-child{border-${side}-color:#B7791F} tr.t-green td:first-child{border-${side}-color:#1B8354} tr.t-past td:first-child{border-${side}-color:#6B7785}
.mpill{display:inline-block;padding:.6mm 2.4mm;border-radius:99px;font-weight:700;font-size:8pt;white-space:nowrap} .m-red{background:#FBE5DF;color:#8A2F1B} .m-amber{background:#FBEFD6;color:#7A5212} .m-green{background:#E2F3E9;color:#0D4A31} .m-past{background:#E9EDF1;color:#4A5A6A}
a.map{text-decoration:none} .yes{color:#1B8354;font-weight:700} .no{color:#8A2F1B;font-weight:700} .sub{font-size:7.5pt;color:#7A8896}
.empty{padding:10mm;text-align:center;color:#7A8896;border:1px dashed #D5DCE3;border-radius:3mm}
.foot{margin-top:6mm;display:flex;justify-content:space-between;font-size:7.5pt;color:#9AA7B4;border-top:1px solid #E6EBF0;padding-top:2mm}
@media screen{.hero{padding:10mm 4%} .wrap{padding:0 4% 8mm} .kpis{grid-template-columns:repeat(4,minmax(0,1fr))} .ucards{grid-template-columns:repeat(auto-fill,minmax(340px,1fr))} .gantt{--gn:56mm}}
</style></head><body>
<div class="hero"><span class="tag">${esc(t("leases.report.tag", { date: fmtDay(today) }))}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>${filtersLine ? `<div class="filters">${esc(filtersLine)}</div>` : ""}</div>
<div class="wrap">
<div class="kpis">
<div class="kpi" style="--k:#0D4A31"><span>${esc(t("leases.report.kpiCount"))}</span><b>${rows.length}</b><small>${esc(t("leases.report.kpiCountSub", { count: live.length }))}</small></div>
<div class="kpi" style="--k:#A8432B"><span>${esc(t("leases.report.kpi12"))}</span><b>${within(-1, 365)}</b><small>${esc(t("leases.report.kpi12Sub"))}</small></div>
<div class="kpi" style="--k:#B7791F"><span>${esc(t("leases.report.kpi24"))}</span><b>${within(365, 730)}</b><small>${esc(t("leases.report.kpi24Sub"))}</small></div>
<div class="kpi" style="--k:#0E8F8A"><span>${esc(t("leases.autoRenewShort"))}</span><b>${autoCount}</b><small>${esc(t("leases.report.kpiAutoSub", { count: rows.length }))}</small></div>
</div>
<div class="lead">${esc(lead)}</div>
${urgent.length ? `<h2>${esc(t("leases.report.urgentTitle"))}</h2><div class="ucards">${urgent.map(ucard).join("")}</div>` : ""}
${live.length ? `<h2>${esc(t("leases.report.timelineTitle"))}</h2><div class="gantt">
<div class="gaxis"><div></div><div class="gtrack">${years.map((y) => `<span class="ylab" style="${side}:${pos(`${y}-01-01`).toFixed(2)}%">${y}</span>`).join("")}</div></div>
<div style="position:relative">${ganttRows}<div style="position:absolute;top:0;bottom:0;${side === "right" ? "right:var(--gn);left:0" : "left:var(--gn);right:0"};pointer-events:none">${years.slice(1).map((y) => `<i class="yline" style="${side}:${pos(`${y}-01-01`).toFixed(2)}%;top:0"></i>`).join("")}<div class="today" style="${side}:${todayPos.toFixed(2)}%"><span>${esc(t("leases.report.today"))}</span></div></div></div>
${live.length > 40 ? `<div class="sub">${esc(t("leases.report.timelineMore", { count: live.length - 40 }))}</div>` : ""}
<div class="legend"><span><i style="background:#A8432B"></i>${esc(t("leases.report.legend12"))}</span><span><i style="background:#B7791F"></i>${esc(t("leases.report.legend24"))}</span><span><i style="background:#1B8354"></i>${esc(t("leases.report.legendLater"))}</span><span><i style="background:#fff;border:.6mm solid #083524;width:2.6mm;border-radius:50%"></i>${esc(t("leases.report.decisionBy"))}</span></div>
</div>` : ""}
<h2>${esc(t("leases.report.tableTitle"))}</h2>
${rows.length ? `<table><thead><tr><th>#</th><th>${esc(t("leases.contract"))}</th><th>${esc(t("leases.category.label"))}</th><th>${esc(t("leases.brands.label"))}</th><th>${esc(t("leases.property.city"))}</th><th>${esc(t("leases.counterparty"))}</th><th>${esc(t("leases.startDate"))}</th><th>${esc(t("leases.endDate"))}</th><th>${esc(t("leases.report.remaining"))}</th><th>${esc(t("leases.autoRenew"))}</th><th>${esc(t("leases.report.decisionBy"))}</th><th>${esc(t("leases.status"))}</th></tr></thead><tbody>${tableRows}</tbody></table>` : `<div class="empty">${esc(t("leases.report.empty"))}</div>`}
<div class="foot"><span>${esc(companyName)}</span><span>${esc(t("leases.report.footer"))}</span></div>
</div></body></html>`;
}
