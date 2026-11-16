import { renderHtmlToPdf } from "./zatca/pdf/renderPdf";
import { KSA_DATE_OPTIONS } from "./displayDates";
import type { getShiftsDailyReport, ShiftReportCell, ShiftReportTotals } from "../modules/stationShiftsReports/stationShiftsReports.service";

type Report = Awaited<ReturnType<typeof getShiftsDailyReport>>;
type Product = "gasoline_91" | "gasoline_95" | "diesel";
const PRODUCTS: Product[] = ["gasoline_91", "gasoline_95", "diesel"];
/** ما يشترك فيه صف الوردية (ShiftReportCell) وصف الإجمالي (ShiftReportTotals) من أرقام. */
type Values = {
  products?: Partial<Record<Product, { liters: number; amount: number | null }>>;
  liters?: number | null; amount?: number | null; network?: number; fuelCard?: number; cash?: number; credit?: number; expenses?: number;
  collected?: number; variance?: number | null;
};

const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const lit = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const day = (v: string | Date) => new Date(v).toLocaleDateString("en-GB", { ...KSA_DATE_OPTIONS, year: "numeric", month: "2-digit", day: "2-digit" });
const time = (v: string | Date | null) => (v ? new Date(v).toLocaleTimeString("en-GB", { ...KSA_DATE_OPTIONS, hour: "2-digit", minute: "2-digit" }) : "");

const LABELS = {
  ar: {
    title: "تقرير الورديات اليومي", period: "الفترة", station: "المحطة", allStations: "كل المحطات", shift: "الوردية", details: "العامل والحالة",
    morning: "صباحي", night: "مسائي", dayTotal: "إجمالي اليوم", noShift: "لا توجد وردية", liters: "لتر", amount: "المبلغ", totalSales: "إجمالي المبيعات",
    collection: "التحصيل", network: "شبكة", fuelCard: "بطاقات", cash: "نقد", credit: "آجل", expenses: "مصروفات", collected: "إجمالي التحصيل",
    variance: "الفرق", periodTotals: "إجمالي الفترة", morningTotal: "إجمالي الصباحي", nightTotal: "إجمالي المسائي", periodTotal: "الإجمالي العام",
    shifts: "وردية", deviceIncomplete: "بيانات الجهاز ناقصة", readingsIncomplete: "قراءات ناقصة",
    varianceNote: "الفرق = إجمالي التحصيل − إجمالي المبيعات: موجب زيادة، سالب عجز. الوردية المفتوحة تظهر مبيعاتها حتى وقت التقرير بلا فرق.",
    products: { gasoline_91: "بنزين 91", gasoline_95: "بنزين 95", diesel: "ديزل" },
    statuses: { open: "مفتوحة", submitted: "مُسلَّمة", under_review: "قيد المراجعة", approved: "معتمدة", posted: "مرحَّلة" } as Record<string, string>,
  },
  en: {
    title: "Daily shifts report", period: "Period", station: "Station", allStations: "All stations", shift: "Shift", details: "Worker and status",
    morning: "Morning", night: "Night", dayTotal: "Day total", noShift: "No shift", liters: "Liters", amount: "Amount", totalSales: "Total sales",
    collection: "Collection", network: "Network", fuelCard: "Fuel cards", cash: "Cash", credit: "Credit", expenses: "Expenses", collected: "Total collected",
    variance: "Variance", periodTotals: "Period totals", morningTotal: "Morning total", nightTotal: "Night total", periodTotal: "Grand total",
    shifts: "shifts", deviceIncomplete: "Controller data incomplete", readingsIncomplete: "Incomplete readings",
    varianceNote: "Variance = total collected − total sales: positive is a surplus, negative a shortage. An open shift shows its sales up to the report time with no variance.",
    products: { gasoline_91: "Gasoline 91", gasoline_95: "Gasoline 95", diesel: "Diesel" },
    statuses: { open: "Open", submitted: "Submitted", under_review: "Under review", approved: "Approved", posted: "Posted" } as Record<string, string>,
  },
};

/** المنتجات التي بيع منها شيء في الفترة — نفس قاعدة الشاشة (ShiftsReportTab): لا عمود ديزل فارغ لمحطة بلا ديزل. */
export function reportProducts(report: Report): Product[] {
  const used = PRODUCTS.filter((p) => report.totals.products[p].liters > 0
    || report.rows.some((r) => [...r.morning, ...r.night].some((c) => c.products?.[p])));
  return used.length ? used : ["gasoline_91", "gasoline_95"];
}

/**
 * تقرير الورديات اليومي PDF (أفقي A4): نفس جدول الشاشة — لكل يوم ومحطة صف صباحي وصف مسائي وصف إجمالي اليوم، ثم إجمالي
 * الفترة. رأس الجدول (<thead>) يتكرر أعلى كل صفحة، ولا يُقسَم صف بين صفحتين. الأوقات بتوقيت الرياض والتقويم ميلادي.
 */
export function buildShiftsReportHtml(report: Report, company: { name: string } | null, opts: { stationName?: string | null; lang: string }) {
  const en = opts.lang === "en";
  const L = en ? LABELS.en : LABELS.ar;
  const products = reportProducts(report);
  const cols = products.length * 2 + 11;

  const values = (v: Values | null, totals: boolean) => {
    const productCells = products.map((p) => {
      const pv = v?.products?.[p];
      return `<td class="num">${pv ? lit(pv.liters) : totals ? lit(0) : "—"}</td><td class="num">${pv ? money(pv.amount) : totals ? money(0) : "—"}</td>`;
    }).join("");
    const variance = v?.variance ?? null;
    return `${productCells}<td class="num b">${lit(v?.liters)}</td><td class="num b">${money(v?.amount)}</td>`
      + [v?.network, v?.fuelCard, v?.cash, v?.credit, v?.expenses].map((x) => `<td class="num">${money(x)}</td>`).join("")
      + `<td class="num b">${money(v?.collected)}</td><td class="num b ${variance == null ? "" : variance < 0 ? "neg" : "pos"}">${money(variance)}</td>`;
  };
  const shiftRows = (cells: ShiftReportCell[], label: string) => (cells.length ? cells : [null]).map((c) => {
    if (!c) return `<tr><td>${label}</td><td class="muted">${L.noShift}</td><td colspan="${cols - 2}" class="muted">—</td></tr>`;
    const flags = [L.statuses[c.status] ?? c.status, ...(c.deviceDataComplete === false ? [L.deviceIncomplete] : []), ...(!c.complete ? [L.readingsIncomplete] : [])].join(" · ");
    const span = c.openedAt ? ` · ${time(c.openedAt)}–${c.closedAt ? time(c.closedAt) : "…"}` : "";
    return `<tr><td>${label}</td><td class="small">${escape(c.worker || "—")}${span}<br><span class="${c.deviceDataComplete === false || !c.complete ? "neg" : "muted"}">${escape(flags)}</span></td>${values(c, false)}</tr>`;
  }).join("");
  const totalRow = (label: string, v: ShiftReportTotals, cls: string) =>
    `<tr class="${cls}"><td>${label}</td><td class="small">${v.shifts} ${L.shifts}</td>${values(v, true)}</tr>`;

  const body = report.rows.map((r) => `<tr class="day"><td colspan="${cols}">${day(r.day)} · ${escape(r.stationName)}</td></tr>`
    + shiftRows(r.morning, L.morning) + shiftRows(r.night, L.night) + totalRow(L.dayTotal, r.total, "sub")).join("");

  const head = `<tr><th rowspan="2">${L.shift}</th><th rowspan="2">${L.details}</th>${products.map((p) => `<th colspan="2">${L.products[p]}</th>`).join("")}`
    + `<th colspan="2">${L.totalSales}</th><th colspan="6">${L.collection}</th><th rowspan="2">${L.variance}</th></tr>`
    + `<tr>${products.map(() => `<th>${L.liters}</th><th>${L.amount}</th>`).join("")}<th>${L.liters}</th><th>${L.amount}</th>`
    + `<th>${L.network}</th><th>${L.fuelCard}</th><th>${L.cash}</th><th>${L.credit}</th><th>${L.expenses}</th><th>${L.collected}</th></tr>`;

  return `<!doctype html><html lang="${en ? "en" : "ar"}" dir="${en ? "ltr" : "rtl"}"><head><meta charset="UTF-8"><style>
  body{font-family:Arial,'Noto Sans Arabic',sans-serif;color:#1f2937;font-size:8.5px;margin:0}
  header{background:#20252d;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  h1{font-size:15px;margin:0}h2{font-size:14px;color:#f59e0b;margin:0}header p{margin:3px 0 0}
  table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}
  th{background:#eef1f4;color:#334155;font-weight:bold;text-align:center}td,th{padding:4px 3px;border:1px solid #e2e8f0}
  .num{white-space:nowrap;direction:ltr;text-align:end}.b{font-weight:bold}.neg{color:#b91c1c}.pos{color:#15803d}.muted{color:#64748b}.small{font-size:7.5px}
  tr.day td{background:#dfe5ea;font-weight:bold;font-size:9px}tr.sub td{background:#f4f6f8;font-weight:bold}
  tr.grand td{background:#20252d;color:#fbbf24;font-weight:bold}tr.grand .neg{color:#fca5a5}tr.grand .pos{color:#86efac}
  .note{color:#64748b;margin-top:8px}
  </style></head><body>
  <header><div><h1>${escape(company?.name || "أثر المحاسبي")}</h1><p>${L.station}: ${escape(opts.stationName || L.allStations)}</p></div>
  <div><h2>${L.title}</h2><p>${L.period}: ${day(report.dateFrom)} — ${day(report.dateTo)}</p></div></header>
  <table><thead>${head}</thead><tbody>${body}
  <tr class="day"><td colspan="${cols}">${L.periodTotals}</td></tr>
  ${totalRow(L.morningTotal, report.byType.morning, "sub")}${totalRow(L.nightTotal, report.byType.night, "sub")}${totalRow(L.periodTotal, report.totals, "grand")}
  </tbody></table><p class="note">${L.varianceNote}</p></body></html>`;
}

export async function buildShiftsReportPdf(...args: Parameters<typeof buildShiftsReportHtml>) {
  return renderHtmlToPdf(buildShiftsReportHtml(...args), { landscape: true });
}
