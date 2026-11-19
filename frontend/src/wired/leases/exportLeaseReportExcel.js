import { contractCity, endTone } from "./leaseReport";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D4A31" } };
const TONE_FILL = { red: "FFFBE5DF", amber: "FFFBEFD6", green: "FFE2F3E9", past: "FFE9EDF1" };
const NUM_FMT = "#,##0.00";
const dateCell = (day) => (day ? new Date(`${day}T00:00:00Z`) : null);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * يصدّر تقرير انتهاء عقود الإيجار كملف Excel بنفس العقود الظاهرة في التقرير بعد الفلترة (filterReportContracts).
 * exceljs يُحمَّل ديناميكياً عند الضغط فقط، مثل بقية تصديرات النظام.
 */
export async function exportLeaseReportExcel({ contracts, today, companyName, title, filtersLine, t, lang = "ar" }) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(t("leases.views.report"), { views: [{ rightToLeft: lang !== "en", state: "frozen", ySplit: 5 }] });

  const headers = [
    "#", t("leases.contract"), t("leases.direction.label"), t("leases.category.label"), t("leases.brands.label"), t("leases.property.city"),
    t("leases.counterparty"), t("leases.contractNumber"), t("leases.startDate"), t("leases.endDate"), t("leases.report.remainingDays"),
    t("leases.autoRenew"), t("leases.noticeDays"), t("leases.report.decisionBy"), t("leases.status"), t("leases.contractValue"), t("leases.property.mapUrl"),
  ];
  sheet.columns = [6, 34, 18, 16, 14, 16, 34, 20, 13, 13, 12, 12, 12, 15, 11, 16, 34].map((width) => ({ width }));

  const titleRow = sheet.addRow([title]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, headers.length);
  titleRow.getCell(1).font = { size: 15, bold: true, color: { argb: "FF0D4A31" } };
  const companyRow = sheet.addRow([`${companyName} — ${t("leases.report.tag", { date: today })}`]);
  sheet.mergeCells(companyRow.number, 1, companyRow.number, headers.length);
  companyRow.getCell(1).font = { size: 11, color: { argb: "FF445565" } };
  const filterRow = sheet.addRow([filtersLine || t("leases.report.noFilters")]);
  sheet.mergeCells(filterRow.number, 1, filterRow.number, headers.length);
  filterRow.getCell(1).font = { size: 10, italic: true, color: { argb: "FF5B6B7B" } };
  sheet.addRow([]);

  const head = sheet.addRow(headers);
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  head.height = 30;

  contracts.forEach((c, i) => {
    const left = daysBetween(today, c.endDate);
    const url = /^https?:\/\/\S+$/i.test(c.propertyDetails?.mapUrl || "") ? c.propertyDetails.mapUrl : null;
    const row = sheet.addRow([
      i + 1, c.title, t(`leases.direction.${c.direction || "lessee"}Tab`), c.category ? t(`leases.category.${c.category}`) : "",
      c.brandName || "", contractCity(c), c.counterparty || "", c.contractNumber || "",
      dateCell(c.startDate), dateCell(c.endDate), left, c.autoRenew ? t("leases.report.yes") : t("leases.report.no"),
      c.noticeDays ?? null, dateCell(c.noticeDeadline), t(`leases.contractStatus.${c.status || "active"}`),
      c.contractValue ?? null, url ? { text: t("leases.property.openMap"), hyperlink: url } : "",
    ]);
    [9, 10, 14].forEach((col) => { row.getCell(col).numFmt = "yyyy/mm/dd"; });
    row.getCell(16).numFmt = NUM_FMT;
    if (url) row.getCell(17).font = { color: { argb: "FF1A56B8" }, underline: true };
    const fill = TONE_FILL[endTone(c.endDate, today)];
    row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    row.getCell(11).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    row.eachCell((cell) => { cell.border = { bottom: { style: "hair", color: { argb: "FFD5DCE3" } } }; });
  });
  sheet.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: headers.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/\s+/g, "_")}_${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
