import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/** طباعة سند قيد محاسبي — يُستخدَم من شاشة القيود اليومية، يفيد من هيدر/فوتر PrintShell المشترك تلقائياً */
export default function JournalVoucherViewModal({ entry, companies, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(t);
  }, [autoPrint, entry.id]);

  const company = companies?.find((c) => c.id === entry.companyId);
  const total = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);

  return (
    <PrintShell
      subtitle="سند قيد محاسبي"
      company={company}
      refNode={
        <>
          <div>رقم القيد: <strong>{entry.id.slice(-8)}</strong></div>
          <div>التاريخ: <strong>{entry.date.slice(0, 10)}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>البيان</span><strong>{entry.memo || "بدون بيان"}</strong></div>
        <div><span>الحالة</span><strong>{entry.status === "posted" ? "مرحّل" : "مسودة"}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr><th>الحساب</th><th>مركز التكلفة</th><th>القسم</th><th>مدين</th><th>دائن</th></tr>
        </thead>
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.account?.name}</td>
              <td>{l.costCenter?.name || "—"}</td>
              <td>{l.department || "—"}</td>
              <td className="num">{Number(l.debit) ? fmt(Number(l.debit)) : "—"}</td>
              <td className="num">{Number(l.credit) ? fmt(Number(l.credit)) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(total)}</td><td className="num strong">{fmt(total)}</td></tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
