import React, { useEffect, useMemo, useState } from "react";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import { listDepartments } from "../api/departments";
import { getAccountLedger } from "../api/reports";
import { fmt } from "../legacy/constants";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import AccountLedgerPrintModal from "./AccountLedgerPrintModal";
import { useDeferredFilters } from "./shared/useDeferredFilters";

const emptyFilters = { accountId: "", subAccountId: "", costCenterId: "", departmentId: "", dateFrom: "", dateTo: "" };

/** كل حسابات الترحيل (isPosting) تحت حساب مجموعة معيّن، بحث بالعمق عبر parentId — مطابق تماماً
 * لمنطق collectPostingDescendants في reports.service.ts (الخادم)، لكن على القائمة المحمَّلة محلياً. */
function collectPostingDescendants(accounts, rootId) {
  const byParent = new Map();
  accounts.forEach((a) => byParent.set(a.parentId, [...(byParent.get(a.parentId) || []), a]));
  const result = [];
  const walk = (parentId) => {
    for (const child of byParent.get(parentId) || []) {
      if (child.isPosting) result.push(child);
      else walk(child.id);
    }
  };
  walk(rootId);
  return result;
}

/**
 * كشف حساب الأستاذ لأي حساب من شجرة الحسابات — يعرض حركة الحساب مرتبة زمنياً مع رصيد متحرك،
 * ويعرض "وصف السطر" (الحقل الجديد على مستوى كل سطر) بجانب البيان العام للقيد، عشان مراجع كشف
 * الحساب يفهم تفاصيل كل حركة دون فتح القيد الكامل.
 */
export default function AccountLedgerModule({ companyId, companies, initialAccountId, onConsumeInitialAccountId }) {
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [departments, setDepartments] = useState([]);
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
    listCostCenters().then(setCostCenters).catch((err) => setError(err.message));
    listDepartments().then(setDepartments).catch((err) => setError(err.message));
    alf.reset(emptyFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // دخول مباشر لحساب معيّن (زر "عرض في شجرة الحسابات" من شاشة عميل/مورد/موظف) — يفتح الحساب
  // ويجلب كشفه فوراً بلا حاجة لاختياره يدوياً من القائمة، ثم يُستهلَك (onConsumeInitialAccountId)
  // حتى لا يعيد فرض نفسه لو غيّر المستخدم الحساب يدوياً بعدها وعاد لنفس التبويب.
  useEffect(() => {
    if (!initialAccountId || !companyId) return;
    alf.reset({ ...emptyFilters, accountId: initialAccountId });
    onConsumeInitialAccountId?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccountId, companyId]);

  // لو الحساب المختار في الفلتر مجموعة (isPosting=false)، تظهر قائمة الحسابات الفرعية (التفصيلية
  // فقط) تحته — اختيار حساب فرعي محدَّد منها يُضيّق الكشف عليه وحده؛ بلا اختيار، يبقى السلوك
  // الافتراضي كشفاً مجمَّعاً لكل الحسابات الفرعية معاً (كما كان قبل هذه الإضافة).
  const selectedAccount = useMemo(() => accounts.find((a) => a.id === alf.draft.accountId), [accounts, alf.draft.accountId]);
  const subAccountOptions = useMemo(
    () => (selectedAccount && !selectedAccount.isPosting ? collectPostingDescendants(accounts, selectedAccount.id) : []),
    [accounts, selectedAccount],
  );

  const costCenterOptions = useMemo(
    () => costCenters.filter((c) => !c.companyId || c.companyId === companyId),
    [costCenters, companyId],
  );
  const departmentOptions = useMemo(
    () => departments.filter((d) => !d.companyId || d.companyId === companyId),
    [departments, companyId],
  );

  useEffect(() => {
    const f = alf.applied;
    const effectiveAccountId = f.subAccountId || f.accountId;
    if (!effectiveAccountId || !companyId) { setLedger(null); return; }
    setLoading(true);
    setError("");
    getAccountLedger(effectiveAccountId, {
      companyId, from: f.dateFrom || undefined, to: f.dateTo || undefined,
      costCenterId: f.costCenterId || undefined, departmentId: f.departmentId || undefined,
    })
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
                <AccountSearchSelect
                  accounts={accounts}
                  value={alf.draft.accountId}
                  onChange={(accountId) => alf.setDraft((prev) => ({ ...prev, accountId, subAccountId: "" }))}
                  placeholder="اختر حساباً لعرض حركته"
                />
              </label>
              {subAccountOptions.length > 0 && (
                <label>
                  الحساب الفرعي (اختياري — لتضييق الكشف على حساب واحد بعينه)
                  <select value={alf.draft.subAccountId} onChange={(e) => alf.setField("subAccountId", e.target.value)}>
                    <option value="">— كشف مجمَّع لكل الحسابات الفرعية —</option>
                    {subAccountOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </label>
              )}
              <label>مركز التكلفة
                <select value={alf.draft.costCenterId} onChange={(e) => alf.setField("costCenterId", e.target.value)}>
                  <option value="">كل مراكز التكلفة</option>
                  {costCenterOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>القسم
                <select value={alf.draft.departmentId} onChange={(e) => alf.setField("departmentId", e.target.value)}>
                  <option value="">كل الأقسام</option>
                  {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
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
