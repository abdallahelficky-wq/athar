import React from "react";
import { PrintShell } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/** نسخة قابلة للطباعة من كشف حساب الأستاذ لأي حساب — نفس أسلوب StatementOfAccountModal، داخل PrintShell المشترك */
export default function AccountLedgerPrintModal({ ledger, companyId, companies, onClose }) {
  const company = companies?.find((c) => c.id === companyId);

  return (
    <PrintShell
      subtitle="كشف حساب الأستاذ"
      company={company}
      refNode={<div>الحساب: <strong>{ledger.account.name}</strong></div>}
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>الرصيد الختامي</span><strong>{fmt(Math.abs(ledger.closingBalance))} {ledger.closingBalance >= 0 ? "مدين" : "دائن"}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr>
            <th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>الوصف</th>
            {!ledger.account.isPosting && <th>حساب الترحيل</th>}
            <th>مدين</th><th>دائن</th><th>الرصيد</th>
          </tr>
        </thead>
        <tbody>
          {ledger.rows.map((r, i) => (
            <tr key={r.journalEntryId + i}>
              <td>{r.date.slice(0, 10)}</td>
              <td>{r.journalEntryId.slice(-8)}</td>
              <td>{r.entryMemo || "—"}</td>
              <td>{r.lineDescription || "—"}</td>
              {!ledger.account.isPosting && <td>{r.accountCode} — {r.accountName}</td>}
              <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
              <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
              <td className="num strong">{fmt(r.balance)}</td>
            </tr>
          ))}
          {ledger.rows.length === 0 && <tr><td className="empty" colSpan={ledger.account.isPosting ? 7 : 8}>لا توجد حركات على هذا الحساب بعد.</td></tr>}
        </tbody>
        <tfoot>
          <tr><td className="foot-label" colSpan={ledger.account.isPosting ? 6 : 7}>الرصيد الختامي</td><td className="num strong">{fmt(ledger.closingBalance)}</td></tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
