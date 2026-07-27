import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt } from "../../legacy/constants";

const ROW_FIELDS = [
  ["basic", "الأساسي"], ["housing", "بدل سكن"], ["transport", "بدل مواصلات"], ["otherAllow", "بدلات أخرى"],
  ["otherAdd", "إضافات أخرى"], ["overtime", "بدل إضافي"], ["gosi", "تأمينات"], ["absence", "غياب"],
  ["advance", "سلف"], ["violation", "مخالفات"], ["penalty", "عقوبات"], ["otherDed", "خصومات أخرى"],
];

/** طباعة كشف الرواتب كاملاً (أفقي — الجدول عريض) — عبر PrintShell المشترك */
export default function PayrollPrintModal({ run, rows, totals, month, company, autoPrint, onClose }) {
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
              {ROW_FIELDS.map(([f, label]) => <th key={f}>{label}</th>)}
              <th>الصافي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td>{r.employeeName}</td>
                {ROW_FIELDS.map(([f]) => <td key={f} className="num">{fmt(r[f])}</td>)}
                <td className="num strong">{fmt(r.net)}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                <td className="foot-label">الإجمالي</td>
                {ROW_FIELDS.map(([f]) => <td key={f} className="num">{fmt(totals[f])}</td>)}
                <td className="num strong">{fmt(totals.net)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </PrintShell>
  );
}
