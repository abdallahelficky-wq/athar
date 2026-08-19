import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt } from "../../legacy/constants";

/** طباعة كشف الرواتب كاملاً (أفقي — الجدول عريض) — عبر PrintShell المشترك.
 * الأعمدة (columns) ديناميكية حسب بنود الشركة الفعلية وتخصيص PayrollSettings.payslipColumns. */
export default function PayrollPrintModal({ run, rows, totals, columns, month, company, autoPrint, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(true), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, run.id]);

  return (
    <PrintShell
      subtitle={t("hr.payrollPrint.subtitle")}
      company={company}
      landscape
      refNode={<div>{t("hr.payrollPrint.month")}: <strong>{month}</strong></div>}
      onClose={onClose}
    >
      <div className="wide-table-wrap">
        <table className="ledger-table voucher-table wide-payroll-table">
          <thead>
            <tr>
              <th>{t("hr.payrollPrint.employee")}</th>
              {columns.map((col) => <th key={col.id}>{col.name}</th>)}
              <th>{t("hr.payrollPrint.net")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td>{r.employeeName}</td>
                {columns.map((col) => <td key={col.id} className="num">{fmt(r.componentValues[col.id] || 0)}</td>)}
                <td className="num strong">{fmt(r.net)}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                <td className="foot-label">{t("hr.payrollPrint.total")}</td>
                {columns.map((col) => <td key={col.id} className="num">{fmt(totals.byComponent[col.id] || 0)}</td>)}
                <td className="num strong">{fmt(totals.net)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </PrintShell>
  );
}
