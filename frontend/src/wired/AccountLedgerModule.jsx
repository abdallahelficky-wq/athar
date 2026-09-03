import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import { listDepartments } from "../api/departments";
import { listBranches } from "../api/branches";
import { getAccountLedger } from "../api/reports";
import { fmt } from "../legacy/constants";
import { downloadCsv } from "../legacy/shared";
import { routes } from "../routes";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import AccountLedgerPrintModal from "./AccountLedgerPrintModal";
import { useDeferredFilters } from "./shared/useDeferredFilters";

const emptyFilters = { accountId: "", subAccountId: "", costCenterId: "", departmentId: "", branchId: "", dateFrom: "", dateTo: "" };

/** يدمج بيان القيد العام مع وصف السطر التفصيلي (إن وُجد) في نص واحد لعمود "البيان" — عرض فقط،
 * الحقلان يبقيان منفصلين تماماً في التخزين والاستجابة. */
function combineMemo(memo, description) {
  const parts = [memo, description].filter(Boolean);
  return parts.length ? parts.join(" - ") : "—";
}

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
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
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
    listBranches(companyId).then(setBranches).catch((err) => setError(err.message));
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
  // نفس أسلوب الفترة في طباعة ميزان المراجعة (TrialBalanceTreePrintModal) بالضبط، مُطبَّقاً هنا
  // على فلاتر كشف حساب الأستاذ المُطبَّقة فعلياً (alf.applied)، لعرضها أعلى الشاشة وأعلى الطباعة معاً.
  const periodLabel = alf.applied.dateFrom || alf.applied.dateTo
    ? t("reports.trialPrint.periodWithDates", {
        from: alf.applied.dateFrom || t("reports.trialPrint.periodDefaultFrom"),
        to: alf.applied.dateTo || t("reports.trialPrint.periodDefaultTo"),
      })
    : t("reports.trialPrint.periodAllTime");

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
  const branchOptions = useMemo(
    () => branches.filter((b) => b.isActive || b.id === alf.draft.branchId),
    [branches, alf.draft.branchId],
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
      branchId: f.branchId || undefined,
    })
      .then(setLedger)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alf.applied, companyId]);

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("nav.groups.accounts"), t("nav.tabs.ledger")]} />
        <h2>{t("nav.tabs.ledger")}</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}

      {!companyId ? (
        <p className="empty">{t("common.noCompany")}</p>
      ) : (
        <>
          <div className="panel form-panel">
            <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); alf.apply(); }}>
              <label>
                {t("accountLedger.accountLabel")}
                <AccountSearchSelect
                  accounts={accounts}
                  value={alf.draft.accountId}
                  onChange={(accountId) => alf.setDraft((prev) => ({ ...prev, accountId, subAccountId: "" }))}
                  placeholder={t("accountLedger.accountPlaceholder")}
                />
              </label>
              {subAccountOptions.length > 0 && (
                <label>
                  {t("accountLedger.subAccountLabel")}
                  <select value={alf.draft.subAccountId} onChange={(e) => alf.setField("subAccountId", e.target.value)}>
                    <option value="">{t("accountLedger.subAccountAllOption")}</option>
                    {subAccountOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </label>
              )}
              <label>{t("accountLedger.costCenterLabel")}
                <select value={alf.draft.costCenterId} onChange={(e) => alf.setField("costCenterId", e.target.value)}>
                  <option value="">{t("accountLedger.allCostCenters")}</option>
                  {costCenterOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>{t("accountLedger.departmentLabel")}
                <select value={alf.draft.departmentId} onChange={(e) => alf.setField("departmentId", e.target.value)}>
                  <option value="">{t("accountLedger.allDepartments")}</option>
                  {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              {branchOptions.length > 0 && (
                <label>{t("accountLedger.branchLabel")}
                  <select value={alf.draft.branchId} onChange={(e) => alf.setField("branchId", e.target.value)}>
                    <option value="">{t("accountLedger.allBranches")}</option>
                    {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
                  </select>
                </label>
              )}
              <label>{t("accountLedger.dateFrom")}<input type="date" value={alf.draft.dateFrom} onChange={(e) => alf.setField("dateFrom", e.target.value)} /></label>
              <label>{t("accountLedger.dateTo")}<input type="date" value={alf.draft.dateTo} onChange={(e) => alf.setField("dateTo", e.target.value)} /></label>
              <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("accountLedger.showResults")}</button>
              {ledger && (
                <>
                  <button type="button" className="btn-ghost" style={{ alignSelf: "end" }} onClick={() => setPrintOpen(true)}>{t("accountLedger.printBtn")}</button>
                  <button
                    type="button" className="btn-ghost" style={{ alignSelf: "end" }}
                    onClick={() => downloadCsv(t("accountLedger.csvFileName"), [
                      [
                        t("accountLedger.csvHeaders.date"), t("accountLedger.csvHeaders.entryNumber"),
                        t("accountLedger.csvHeaders.memo"), t("accountLedger.csvHeaders.description"),
                        ...(!ledger.account.isPosting ? [t("accountLedger.csvHeaders.postingAccount")] : []),
                        t("accountLedger.csvHeaders.debit"), t("accountLedger.csvHeaders.credit"), t("accountLedger.csvHeaders.balance"),
                      ],
                      ...ledger.rows.map((r) => [
                        r.date.slice(0, 10), r.entryNumber || r.journalEntryId.slice(-8), r.entryMemo || "", r.lineDescription || "",
                        ...(!ledger.account.isPosting ? [`${r.accountCode} — ${r.accountName}`] : []),
                        r.debit || "", r.credit || "", r.balance,
                      ]),
                    ])}
                  >
                    {t("common.exportCsv")}
                  </button>
                </>
              )}
            </form>
          </div>

          {!alf.applied.accountId && <p className="empty">{t("accountLedger.selectPrompt")}</p>}
          {loading && <p className="empty">{t("common.loading")}</p>}

          {ledger && !loading && (
            <div className="panel">
              <div className="voucher-meta">
                <div><span>{t("accountLedger.accountLabel")}</span><strong>{ledger.account.name}</strong></div>
                <div>{periodLabel}</div>
                <div>
                  <span>{t("statementOfAccount.closingBalance")}</span>
                  <strong>{fmt(Math.abs(ledger.closingBalance))} {ledger.closingBalance >= 0 ? t("statementOfAccount.table.debit") : t("statementOfAccount.table.credit")}</strong>
                </div>
              </div>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>{t("statementOfAccount.table.date")}</th><th>{t("accountLedger.table.entryNumber")}</th><th>{t("statementOfAccount.table.memo")}</th>
                    {!ledger.account.isPosting && <th>{t("accountLedger.table.postingAccount")}</th>}
                    <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th><th>{t("statementOfAccount.table.balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {alf.applied.dateFrom && (
                    <tr className="ledger-row-opening">
                      <td colSpan={ledger.account.isPosting ? 5 : 6} className="foot-label">{t("statementOfAccount.openingBalance")}</td>
                      <td className="num strong">{fmt(ledger.openingBalance)}</td>
                    </tr>
                  )}
                  {ledger.rows.map((r, i) => {
                    // يفتح النظام الكامل (بالشريط العلوي وتسجيل الدخول) على شاشة "القيود اليومية"
                    // الحقيقية مع فتح نافذة القيد تلقائياً — لا صفحة عرض منفصلة معزولة عن التطبيق
                    // (انظر معالجة entryId في JournalModule.jsx).
                    const entryHref = routes.journalEntry(r.journalEntryId);
                    return (
                    <tr
                      key={r.journalEntryId + i}
                      className="ledger-row-clickable"
                      onClick={(e) => { if (e.target.closest("a")) return; window.open(entryHref, "_blank", "noopener,noreferrer"); }}
                    >
                      <td>{r.date.slice(0, 10)}</td>
                      <td>
                        <a
                          className="ledger-entry-link"
                          href={entryHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("accountLedger.openEntryTitle")}
                        >
                          {r.entryNumber || r.journalEntryId.slice(-8)}
                        </a>
                      </td>
                      <td>{combineMemo(r.entryMemo, r.lineDescription)}</td>
                      {!ledger.account.isPosting && <td>{r.accountCode} — {r.accountName}</td>}
                      <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
                      <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
                      <td className="num strong">{fmt(r.balance)}</td>
                    </tr>
                    );
                  })}
                  {ledger.rows.length === 0 && <tr><td className="empty" colSpan={ledger.account.isPosting ? 6 : 7}>{t("statementOfAccount.empty")}</td></tr>}
                </tbody>
                <tfoot>
                  <tr><td className="foot-label" colSpan={ledger.account.isPosting ? 5 : 6}>{t("statementOfAccount.closingBalance")}</td><td className="num strong">{fmt(ledger.closingBalance)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {printOpen && ledger && (
        <AccountLedgerPrintModal
          ledger={ledger}
          companyId={companyId}
          companies={companies}
          dateFrom={alf.applied.dateFrom}
          dateTo={alf.applied.dateTo}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}
