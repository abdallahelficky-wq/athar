import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt } from "../../legacy/constants";

/** طباعة كشف الرواتب كاملاً (أفقي — الجدول عريض) — عبر PrintShell المشترك.
 * الأعمدة (columns) ديناميكية حسب بنود الشركة الفعلية وتخصيص PayrollSettings.payslipColumns. */
export default function PayrollPrintModal({ run, rows, totals, columns, month, company, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(true), 200);
    return () => clearTimeout(t);
  }, [autoPrint, run.id]);

  return (
    <PrintShell
      subtitle="كشف رواتب"
      company={company}
      landscape
      refNode={<div>الشهر: <strong>{month}</strong></div>}
      onClose={onClose}
    >
      <div className="wide-table-wrap">
        <table className="ledger-table voucher-table wide-payroll-table">
          <thead>
            <tr>
              <th>الموظف</th>
              {columns.map((col) => <th key={col.id}>{col.name}</th>)}
              <th>الصافي</th>
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
                <td className="foot-label">الإجمالي</td>
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
