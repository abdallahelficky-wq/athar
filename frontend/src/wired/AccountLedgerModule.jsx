import React, { useEffect, useState } from "react";
import { listAccounts } from "../api/accounts";
import { getAccountLedger } from "../api/reports";
import { fmt } from "../legacy/constants";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import AccountLedgerPrintModal from "./AccountLedgerPrintModal";
import { useDeferredFilters } from "./shared/useDeferredFilters";

const emptyFilters = { accountId: "", dateFrom: "", dateTo: "" };

/**
 * كشف حساب الأستاذ لأي حساب من شجرة الحسابات — يعرض حركة الحساب مرتبة زمنياً مع رصيد متحرك،
 * ويعرض "وصف السطر" (الحقل الجديد على مستوى كل سطر) بجانب البيان العام للقيد، عشان مراجع كشف
 * الحساب يفهم تفاصيل كل حركة دون فتح القيد الكامل.
 */
export default function AccountLedgerModule({ companyId, companies }) {
  const [accounts, setAccounts] = useState([]);
  const alf = useDeferredFilters(emptyFilters);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    if (!companyId) { setAccounts([]); alf.reset(emptyFilters); return; }
    // شجرة كاملة (وليس حسابات الترحيل فقط) — يمكن اختيار فرع تجميعي كامل (مثل "الذمم المدينة
    // التجارية") لعرض كشف حركة مجمَّع لكل عملائه معاً، وليس حساب ترحيل بعينه فقط.
    listAccounts({ tree: true, companyId }).then(setAccounts).catch((err) => setError(err.message));
    alf.reset(emptyFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    const f = alf.applied;
    if (!f.accountId || !companyId) { setLedger(null); return; }
    setLoading(true);
    setError("");
    getAccountLedger(f.accountId, { companyId, from: f.dateFrom || undefined, to: f.dateTo || undefined })
      .then(setLedger)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alf.applied, companyId]);

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
            <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); alf.apply(); }}>
              <label>
                الحساب
                <AccountSearchSelect accounts={accounts} value={alf.draft.accountId} onChange={(accountId) => alf.setField("accountId", accountId)} placeholder="اختر حساباً لعرض حركته" />
              </label>
              <label>من تاريخ<input type="date" value={alf.draft.dateFrom} onChange={(e) => alf.setField("dateFrom", e.target.value)} /></label>
              <label>إلى تاريخ<input type="date" value={alf.draft.dateTo} onChange={(e) => alf.setField("dateTo", e.target.value)} /></label>
              <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>إظهار النتائج</button>
              {ledger && (
                <button type="button" className="btn-ghost" style={{ alignSelf: "end" }} onClick={() => setPrintOpen(true)}>طباعة الكشف</button>
              )}
            </form>
          </div>

          {!alf.applied.accountId && <p className="empty">اختر حساباً من الأعلى واضغط "إظهار النتائج" لعرض كشف حركته.</p>}
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
