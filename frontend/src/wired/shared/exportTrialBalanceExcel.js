const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECE6D6" } };
const GROUP_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F1E3" } };
const NUM_FMT = "#,##0.00;[Red]-#,##0.00";

/**
 * يصدّر بالضبط نفس الصفوف الظاهرة حالياً على الشاشة (visibleRows حسب حالة الطي/الفلترة الحالية)
 * كملف xlsx حقيقي منسَّق — عمود "الحساب" يستخدم خاصية المسافة البادئة (indent) الأصلية في Excel
 * بدل مسافات نصية يدوية لتمثيل التداخل الهرمي، وصفوف المجموعات (الحسابات غير القابلة للترحيل)
 * بخط عريض وتظليل خفيف للتمييز البصري، تماماً كما تُعرَض على الشاشة وفي نسخة الطباعة.
 *
 * exceljs (~1MB) يُحمَّل ديناميكياً هنا فقط عند الضغط الفعلي على "تحميل Excel" بدل استيراده أعلى
 * الملف، حتى لا يُثقِل الحزمة الرئيسية المحمَّلة لكل مستخدم بمكتبة نادرة الاستخدام نسبياً.
 */
export async function exportTrialBalanceExcel({ visibleRows, totals, balanced, company, dateFrom, dateTo }) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("ميزان المراجعة", { views: [{ rightToLeft: true }] });

  sheet.columns = [
    { width: 42 },
    { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 },
  ];

  const companyName = company?.shortName || company?.name || "أثر المحاسبي";
  const periodLabel = dateFrom || dateTo
    ? `الفترة: من ${dateFrom || "بداية النشاط"} إلى ${dateTo || "اليوم"}`
    : "الفترة: منذ بداية النشاط حتى اليوم";

  const titleRow = sheet.addRow([companyName]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 7);
  titleRow.getCell(1).font = { size: 14, bold: true };
  titleRow.getCell(1).alignment = { horizontal: "center" };

  const periodRow = sheet.addRow([`ميزان المراجعة — ${periodLabel}`]);
  sheet.mergeCells(periodRow.number, 1, periodRow.number, 7);
  periodRow.getCell(1).font = { size: 11, italic: true, color: { argb: "FF445565" } };
  periodRow.getCell(1).alignment = { horizontal: "center" };

  sheet.addRow([]);

  const groupHeaderRow = sheet.addRow(["", "الرصيد الافتتاحي", "", "حركة الفترة", "", "الرصيد الختامي", ""]);
  sheet.mergeCells(groupHeaderRow.number, 2, groupHeaderRow.number, 3);
  sheet.mergeCells(groupHeaderRow.number, 4, groupHeaderRow.number, 5);
  sheet.mergeCells(groupHeaderRow.number, 6, groupHeaderRow.number, 7);

  const columnTitlesRow = sheet.addRow(["الحساب", "مدين", "دائن", "مدين", "دائن", "مدين", "دائن"]);

  [groupHeaderRow, columnTitlesRow].forEach((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center" };
      cell.border = { bottom: { style: "thin" } };
    });
  });

  for (const { node, depth } of visibleRows) {
    const isGroup = !node.isPosting;
    const row = sheet.addRow([
      `${node.code} — ${node.name}`,
      node.opening.debit || 0,
      node.opening.credit || 0,
      node.period.debit || 0,
      node.period.credit || 0,
      node.closing.debit || 0,
      node.closing.credit || 0,
    ]);
    row.getCell(1).alignment = { indent: depth, horizontal: "right" };
    for (let col = 2; col <= 7; col++) row.getCell(col).numFmt = NUM_FMT;
    if (isGroup) {
      row.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = GROUP_FILL;
      });
    }
  }

  const totalsRow = sheet.addRow([
    "الإجمالي العام",
    totals.openingDebit, totals.openingCredit,
    totals.periodDebit, totals.periodCredit,
    totals.closingDebit, totals.closingCredit,
  ]);
  totalsRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = { top: { style: "double" } };
  });
  for (let col = 2; col <= 7; col++) totalsRow.getCell(col).numFmt = NUM_FMT;

  const statusRow = sheet.addRow([balanced ? "الميزان متوازن ✓" : "تنبيه: الميزان غير متوازن ⚠"]);
  sheet.mergeCells(statusRow.number, 1, statusRow.number, 7);
  statusRow.getCell(1).font = { bold: true, color: { argb: balanced ? "FF2F5D5A" : "FFA8432B" } };
  statusRow.getCell(1).alignment = { horizontal: "center" };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ميزان_المراجعة.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
