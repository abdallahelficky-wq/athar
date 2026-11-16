const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECE6D6" } };
const DAY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDFE5EA" } };
const SUB_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F8" } };
const GRAND_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF20252D" } };
const MONEY = "#,##0.00;[Red]-#,##0.00";
const LITERS = "#,##0.00";

/**
 * تقرير الورديات Excel: نفس صفوف الشاشة وأعمدتها (المنتجات الظاهرة فقط)، أرقام حقيقية لا نصوص، وصفّا العناوين مثبَّتان
 * (freeze) فيبقيان ظاهرين عند التمرير. exceljs يُحمَّل عند الضغط فقط كما في exportTrialBalanceExcel.
 */
export async function exportShiftsReportExcel({ report, products, companyName, stationLabel, periodLabel, t, lang, fileName }) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const cols = products.length * 2 + 11;
  const titleRows = 3;
  const sheet = wb.addWorksheet(t("shiftsReport.tabTitle").slice(0, 31), {
    views: [{ rightToLeft: lang !== "en", state: "frozen", xSplit: 2, ySplit: titleRows + 2 }],
  });
  sheet.columns = [{ width: 16 }, { width: 30 }, ...Array.from({ length: cols - 2 }, () => ({ width: 13 }))];

  for (const [i, text] of [companyName, `${t("shiftsReport.title")} — ${stationLabel}`, periodLabel].entries()) {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, cols);
    row.getCell(1).font = { bold: true, size: i === 0 ? 14 : 11 };
    row.getCell(1).alignment = { horizontal: "center" };
  }

  const head1 = [t("shiftsReport.shift"), t("shiftsReport.details")];
  const head2 = ["", ""];
  for (const p of products) { head1.push(t(`stationSetup.products.${p}`), ""); head2.push(t("shiftsReport.liters"), t("shiftsReport.amount")); }
  head1.push(t("shiftsReport.totalSales"), "", t("shiftsReport.collection"), "", "", "", "", "", t("shiftsReport.variance"));
  head2.push(t("shiftsReport.liters"), t("shiftsReport.amount"), t("shiftsReport.network"), t("shiftsReport.fuelCard"), t("shiftsReport.cash"),
    t("shiftsReport.credit"), t("shiftsReport.expenses"), t("shiftsReport.collected"), "");
  const h1 = sheet.addRow(head1);
  const h2 = sheet.addRow(head2);
  sheet.mergeCells(h1.number, 1, h2.number, 1);
  sheet.mergeCells(h1.number, 2, h2.number, 2);
  products.forEach((_, i) => sheet.mergeCells(h1.number, 3 + i * 2, h1.number, 4 + i * 2));
  const base = 3 + products.length * 2;
  sheet.mergeCells(h1.number, base, h1.number, base + 1);
  sheet.mergeCells(h1.number, base + 2, h1.number, base + 7);
  sheet.mergeCells(h1.number, cols, h2.number, cols);
  for (const r of [h1, h2]) r.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true }; c.fill = HEADER_FILL; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = { bottom: { style: "thin" } };
  });

  const values = (v, totals) => {
    const out = [];
    for (const p of products) {
      const pv = v?.products?.[p];
      out.push(pv ? pv.liters : totals ? 0 : null, pv ? pv.amount : totals ? 0 : null);
    }
    out.push(v?.liters ?? null, v?.amount ?? null, v?.network ?? 0, v?.fuelCard ?? 0, v?.cash ?? 0, v?.credit ?? 0, v?.expenses ?? 0, v?.collected ?? 0, v?.variance ?? null);
    return out;
  };
  const format = (row) => {
    for (let c = 3; c <= cols; c++) {
      const literCol = (c - 3 < products.length * 2 && (c - 3) % 2 === 0) || c === base;
      row.getCell(c).numFmt = literCol ? LITERS : MONEY;
    }
  };
  const flags = (c) => [t(`shiftsReport.statuses.${c.status}`),
    ...(c.deviceDataComplete === false ? [t("shiftsReport.deviceIncomplete")] : []),
    ...(!c.complete ? [t("shiftsReport.readingsIncomplete")] : [])].join(" · ");
  const time = (v) => (v ? new Date(v).toLocaleTimeString("en-GB", { calendar: "gregory", hour: "2-digit", minute: "2-digit" }) : "");
  const addTotal = (label, v, fill, light) => {
    const row = sheet.addRow([label, t("shiftsReport.shiftsCount", { count: v.shifts }), ...values(v, true)]);
    format(row);
    row.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true, color: light ? { argb: "FFFBBF24" } : undefined }; c.fill = fill; });
  };
  const addDay = (text) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, cols);
    row.getCell(1).font = { bold: true }; row.getCell(1).fill = DAY_FILL;
  };

  for (const r of report.rows) {
    addDay(`${r.day.slice(0, 10)} · ${r.stationName}`);
    for (const type of ["morning", "night"]) {
      const cells = r[type].length ? r[type] : [null];
      for (const c of cells) {
        const details = c ? `${c.worker || "—"}${c.openedAt ? ` · ${time(c.openedAt)}–${c.closedAt ? time(c.closedAt) : "…"}` : ""} · ${flags(c)}` : t("shiftsReport.noShift");
        const row = sheet.addRow([t(`shiftsReport.${type}`), details, ...(c ? values(c, false) : [])]);
        format(row);
      }
    }
    addTotal(t("shiftsReport.dayTotal"), r.total, SUB_FILL);
  }
  addDay(t("shiftsReport.periodTotals"));
  addTotal(t("shiftsReport.morningTotal"), report.byType.morning, SUB_FILL);
  addTotal(t("shiftsReport.nightTotal"), report.byType.night, SUB_FILL);
  addTotal(t("shiftsReport.periodTotal"), report.totals, GRAND_FILL, true);
  const note = sheet.addRow([t("shiftsReport.varianceNote")]);
  sheet.mergeCells(note.number, 1, note.number, cols);
  note.getCell(1).alignment = { wrapText: true };
  note.height = 30;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
