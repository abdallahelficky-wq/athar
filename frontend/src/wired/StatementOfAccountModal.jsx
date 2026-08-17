import React, { useEffect, useState } from "react";
import { getCustomerStatement, getSupplierStatement } from "../api/reports";
import { PrintShell } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/**
 * كشف حساب عميل أو مورد — يجلب البيانات من نقطة النهاية الجديدة (سجل حركة + رصيد متحرك
 * على حساب الذمم فقط) ويعرضها داخل PrintShell المشترك، فتظهر جاهزة للطباعة مباشرة (زرّا
 * "طباعة"/"تحميل PDF" من PrintShell نفسه) بنفس هيدر/فوتر أي مطبوعة أخرى في النظام.
 */
export default function StatementOfAccountModal({ kind, party, companyId, companies, onClose }) {
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetcher = kind === "customer" ? getCustomerStatement : getSupplierStatement;
    fetcher(party.id, { companyId }).then(setStatement).catch((e) => setError(e.message));
  }, [kind, party.id, companyId]);

  const company = companies?.find((c) => c.id === companyId);
  const partyLabel = kind === "customer" ? "العميل" : "المورد";

  if (error) {
    return (
      <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="unpost-confirm-box">
          <div className="modal-title-row">
            <h3>تعذّر تحميل كشف الحساب</h3>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">×</button>
          </div>
          <p className="balance-bad">{error}</p>
          <div className="form-btn-group"><button className="btn-ghost" onClick={onClose}>إغلاق</button></div>
        </div>
      </div>
    );
  }
  if (!statement) return null;

  return (
    <PrintShell
      subtitle={`كشف حساب ${partyLabel}`}
      company={company}
      refNode={<div>{partyLabel}: <strong>{party.name}</strong></div>}
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>الرقم الضريبي</span><strong>{party.vatNumber || "—"}</strong></div>
        <div>
          <span>الرصيد الختامي</span>
          <strong>
            {fmt(Math.abs(statement.closingBalance))}{" "}
            {kind === "customer"
              ? (statement.closingBalance >= 0 ? "مدين (له علينا)" : "دائن (لنا عليه)")
              : (statement.closingBalance >= 0 ? "دائن (علينا له)" : "مدين (له علينا)")}
          </strong>
        </div>
      </div>
      <table className="ledger-table voucher-table">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody>
          {statement.rows.map((r, i) => (
            <tr key={r.journalEntryId + i}>
              <td>{r.date.slice(0, 10)}</td>
              <td>{r.memo || "—"}</td>
              <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
              <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
              <td className="num strong">{fmt(r.balance)}</td>
            </tr>
          ))}
          {statement.rows.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد حركات على هذا الحساب بعد.</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label" colSpan={4}>الرصيد الختامي</td>
            <td className="num strong">{fmt(statement.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
