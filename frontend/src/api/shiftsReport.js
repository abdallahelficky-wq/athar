import { api } from "./http";

/** تقرير الورديات اليومي: صباحي/مسائي/إجمالي اليوم لكل محطة في الفترة (stationShiftsReports.getShiftsDailyReport). */
export const getShiftsDailyReport = ({ companyId, dateFrom, dateTo, costCenterId }) => {
  const q = new URLSearchParams({ companyId, dateFrom, dateTo });
  if (costCenterId) q.append("costCenterId", costCenterId);
  return api.get(`/station-shifts-reports/shifts-daily?${q.toString()}`);
};

/** نفس التقرير PDF أفقي من الخادم (buildShiftsReportPdf). */
export const getShiftsDailyReportPdf = ({ companyId, dateFrom, dateTo, costCenterId, lang }) => {
  const q = new URLSearchParams({ companyId, dateFrom, dateTo, lang: lang === "en" ? "en" : "ar" });
  if (costCenterId) q.append("costCenterId", costCenterId);
  return api.getBlob(`/station-shifts-reports/shifts-daily/pdf?${q.toString()}`);
};
