import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import { previewAnnualLeaveJournal, postAnnualLeaveDraft } from "../../api/leaveSettlements";
import { getAccountDisplayName } from "../shared/accountDisplayName";
import HRDialog from "./HRDialog";

const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * نافذة ترحيل مسودة الإجازة السنوية: اختيار حساب الإجازات والبدلات الأخرى (والتذاكر عند وجودها)، ثم معاينة القيد كما
 * سيُرحَّل بالضبط (من الخادم، بنفس دالة الترحيل) قبل زر الترحيل. الصافي يُقيَّد دائناً على حساب الموظف الشخصي.
 */
export default function AnnualLeavePostModal({ draft, onClose, onPosted }) {
  const { i18n } = useTranslation(), ar = i18n.language.startsWith("ar"), L = (a, e) => (ar ? a : e);
  const s = draft.snapshot, req = s.request;
  const [accounts, setAccounts] = useState([]);
  const [chosen, setChosen] = useState({ leaveAccountId: "", additionsAccountId: "", ticketAccountId: "" });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listAccounts({ companyId: draft.companyId, includePartyAccounts: false })
      .then(rows => { if (alive) setAccounts(rows.filter(a => a.isPosting !== false && a.isActive !== false && !a.isArchived && ["expense", "liability"].includes(a.type))); })
      .catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [draft.companyId]);

  // المعاينة من الخادم؛ يُتجاهَل أي رد لم يعد الأحدث حتى لا يغطي رد قديم اختياراً أحدث
  useEffect(() => {
    let stale = false;
    setError("");
    const body = Object.fromEntries(Object.entries(chosen).filter(([, v]) => v));
    previewAnnualLeaveJournal(draft.id, body)
      .then(p => {
        if (stale) return;
        setPreview(p);
        setChosen(c => ({ leaveAccountId: c.leaveAccountId || p.accounts.leaveAccountId || "",
          additionsAccountId: c.additionsAccountId || p.accounts.additionsAccountId || "", ticketAccountId: c.ticketAccountId || p.accounts.ticketAccountId || "" }));
      })
      .catch(e => { if (!stale) { setPreview(null); setError(e.message); } });
    return () => { stale = true; };
  }, [draft.id, chosen.leaveAccountId, chosen.additionsAccountId, chosen.ticketAccountId]);

  const options = useMemo(() => [...accounts].sort((a, b) => String(a.code).localeCompare(String(b.code))), [accounts]);
  const select = (label, key) => (
    <label>{label}
      <select value={chosen[key]} onChange={e => setChosen(c => ({ ...c, [key]: e.target.value }))}>
        <option value="">{L("— اختر الحساب —", "— Choose account —")}</option>
        {options.map(a => <option key={a.id} value={a.id}>{a.code} — {getAccountDisplayName(a, i18n.language)}</option>)}
      </select>
    </label>
  );
  const totalDebit = preview ? preview.lines.reduce((t, l) => t + Number(l.debit), 0) : 0;
  const totalCredit = preview ? preview.lines.reduce((t, l) => t + Number(l.credit), 0) : 0;

  async function post() {
    setBusy(true); setError("");
    try { onPosted(await postAnnualLeaveDraft(draft.id, chosen)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <HRDialog title={L(`ترحيل إجازة ${s.employee.name}`, `Post leave — ${s.employee.name}`)} onClose={onClose}>
      <p className="muted">{L("الراتب على حسابات بنود الرواتب (الأساسي على حساب رواتب قسم الموظف)، وبدل الإجازة على حساب الإجازات، والإضافات على حساب البدلات الأخرى، والصافي دائن على حساب الموظف، ويُصرف منه لاحقاً من قائمة التسويات.",
        "Salary goes to the payroll item accounts (basic to the employee's department salary account), leave pay to the leave account, additions to the other allowances account, and the net is credited to the employee's account, from which it is disbursed later in the settlements list.")}</p>
      <div className="form-grid">
        {s.balance.payAmount > 0 && select(L("حساب مصروف الإجازات", "Leave expense account"), "leaveAccountId")}
        {req.otherAdditions > 0 && select(L("حساب البدلات الأخرى (للإضافات)", "Other allowances account (additions)"), "additionsAccountId")}
        {req.ticketAmount > 0 && select(L("حساب مصروف التذاكر", "Ticket expense account"), "ticketAccountId")}
      </div>
      {error && <p role="alert" className="balance-bad">{error}</p>}
      {preview && <>
        <h4>{L("القيد المحاسبي", "Journal entry")} — {preview.date}</h4>
        <p className="muted">{preview.memo}</p>
        <table className="ledger-table voucher-table">
          <thead><tr><th>{L("الحساب", "Account")}</th><th>{L("البيان", "Description")}</th><th>{L("مدين", "Debit")}</th><th>{L("دائن", "Credit")}</th></tr></thead>
          <tbody>{preview.lines.map((l, i) => <tr key={i}>
            <td>{l.account ? `${l.account.code} — ${getAccountDisplayName(l.account, i18n.language)}` : l.accountId}</td>
            <td>{l.lineDescription || ""}</td>
            <td className="num">{Number(l.debit) ? money(l.debit) : "—"}</td>
            <td className="num">{Number(l.credit) ? money(l.credit) : "—"}</td>
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={2} className="foot-label">{L("الإجمالي", "Total")}</td><td className="num strong">{money(totalDebit)}</td><td className="num strong">{money(totalCredit)}</td></tr></tfoot>
        </table>
      </>}
      <div className="form-btn-group" style={{ marginTop: 16 }}>
        <button className="btn-primary" disabled={busy || !preview} onClick={post}>{L("ترحيل القيد", "Post entry")}</button>
        <button className="btn-ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</button>
      </div>
    </HRDialog>
  );
}
