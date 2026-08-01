import React, { useEffect, useState } from "react";
import { listAccounts } from "../api/accounts";
import { getAccountLedger } from "../api/reports";
import { fmt } from "../legacy/constants";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import AccountLedgerPrintModal from "./AccountLedgerPrintModal";

/**
 * كشف حساب الأستاذ لأي حساب من شجرة الحسابات — يعرض حركة الحساب مرتبة زمنياً مع رصيد متحرك،
 * ويعرض "وصف السطر" (الحقل الجديد على مستوى كل سطر) بجانب البيان العام للقيد، عشان مراجع كشف
 * الحساب يفهم تفاصيل كل حركة دون فتح القيد الكامل.
 */
export default function AccountLedgerModule({ companyId, companies }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    listAccounts({ companyId }).then(setAccounts).catch((err) => setError(err.message));
  }, [companyId]);

  useEffect(() => {
    if (!accountId || !companyId) { setLedger(null); return; }
    setLoading(true);
    setError("");
    getAccountLedger(accountId, { companyId, from: dateFrom || undefined, to: dateTo || undefined })
      .then(setLedger)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accountId, companyId, dateFrom, dateTo]);

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["الحسابات", "كشف حساب الأستاذ"]} />
        <h2>كشف حساب الأستاذ</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}

      {!companyId ? (
        <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>
      ) : (
        <>
          <div className="panel form-panel">
            <div className="filter-bar">
              <label>
                الحساب
                <AccountSearchSelect accounts={accounts} value={accountId} onChange={setAccountId} placeholder="اختر حساباً لعرض حركته" />
              </label>
              <label>من تاريخ<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
              <label>إلى تاريخ<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
              {ledger && (
                <button className="btn-ghost" style={{ alignSelf: "end" }} onClick={() => setPrintOpen(true)}>طباعة الكشف</button>
              )}
            </div>
          </div>

          {!accountId && <p className="empty">اختر حساباً من الأعلى لعرض كشف حركته.</p>}
          {loading && <p className="empty">جارٍ التحميل...</p>}

          {ledger && !loading && (
            <div className="panel">
              <div className="voucher-meta">
                <div><span>الحساب</span><strong>{ledger.account.name}</strong></div>
                <div>
                  <span>الرصيد الختامي</span>
                  <strong>{fmt(Math.abs(ledger.closingBalance))} {ledger.closingBalance >= 0 ? "مدين" : "دائن"}</strong>
                </div>
              </div>
              <table className="ledger-table">
                <thead>
                  <tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>الوصف</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr>
                </thead>
                <tbody>
                  {ledger.rows.map((r, i) => (
                    <tr key={r.journalEntryId + i}>
                      <td>{r.date.slice(0, 10)}</td>
                      <td>{r.journalEntryId.slice(-8)}</td>
                      <td>{r.entryMemo || "—"}</td>
                      <td>{r.lineDescription || "—"}</td>
                      <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
                      <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
                      <td className="num strong">{fmt(r.balance)}</td>
                    </tr>
                  ))}
                  {ledger.rows.length === 0 && <tr><td className="empty" colSpan={7}>لا توجد حركات على هذا الحساب بعد.</td></tr>}
                </tbody>
                <tfoot>
                  <tr><td className="foot-label" colSpan={6}>الرصيد الختامي</td><td className="num strong">{fmt(ledger.closingBalance)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {printOpen && ledger && (
        <AccountLedgerPrintModal ledger={ledger} companyId={companyId} companies={companies} onClose={() => setPrintOpen(false)} />
      )}
    </div>
  );
}
