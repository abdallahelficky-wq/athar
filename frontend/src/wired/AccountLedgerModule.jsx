import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import { listDepartments } from "../api/departments";
import { listBranches } from "../api/branches";
import { getAccountLedger } from "../api/reports";
import AccountLedgerDocument from "./AccountLedgerDocument";
import { exportAccountLedgerExcel, saveLedgerBlob } from "./shared/exportAccountLedgerExcel";
import { getAccountLedgerPdf } from "../api/reports";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import AccountLedgerPrintModal from "./AccountLedgerPrintModal";
import { useDeferredFilters } from "./shared/useDeferredFilters";
import DraftEntriesNotice from "./shared/DraftEntriesNotice";
import { defaultDateRangeForCompany } from "./shared/fiscalClosing";

const emptyFilters = { accountId: "", subAccountId: "", costCenterId: "", departmentId: "", branchId: "", dateFrom: "", dateTo: "" };

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
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const alf = useDeferredFilters(emptyFilters);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const company = companies?.find(c => c.id === companyId);

  // تاريخ إقفال الشركة النشطة تحديداً (لا مصفوفة companies بأكملها) كتبعية للتأثير أدناه — يُعاد
  // حساب الفترة الافتراضية بمجرد توفّر بيانات الشركات فعلياً (قد تُحمَّل بعد companyId بلحظات عند
  // أول فتح للتطبيق)، بلا إعادة ضبط الفلاتر عند كل تغيّر غير متعلّق في المصفوفة نفسها.
  const activeCompanyClosingDate = companies?.find((c) => c.id === companyId)?.fiscalYearClosingDate;

  useEffect(() => {
    if (!companyId) { setAccounts([]); alf.reset(emptyFilters); return; }
    // شجرة كاملة (وليس حسابات الترحيل فقط) — يمكن اختيار فرع تجميعي كامل (مثل "الذمم المدينة
    // التجارية") لعرض كشف حركة مجمَّع لكل عملائه معاً، وليس حساب ترحيل بعينه فقط.
    listAccounts({ tree: true, companyId }).then(setAccounts).catch((err) => setError(err.message));
    listCostCenters().then(setCostCenters).catch((err) => setError(err.message));
    listDepartments().then(setDepartments).catch((err) => setError(err.message));
    listBranches(companyId).then(setBranches).catch((err) => setError(err.message));
    alf.reset(defaultDateRangeForCompany(companies?.find((c) => c.id === companyId), emptyFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, activeCompanyClosingDate]);

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
    if (!effectiveAccountId || !companyId) { setLedger(null); setLoading(false); return; }
    let cancelled = false;
    setLedger(null);
    setLoading(true);
    setError("");
    getAccountLedger(effectiveAccountId, {
      companyId, from: f.dateFrom || undefined, to: f.dateTo || undefined,
      costCenterId: f.costCenterId || undefined, departmentId: f.departmentId || undefined,
      branchId: f.branchId || undefined,
    })
      .then(data => { if (!cancelled) setLedger(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alf.applied, companyId]);

  async function exportReport(kind) {
    setExporting(true); setError("");
    try {
      if (kind === "excel") await exportAccountLedgerExcel({ ledger, company, periodLabel, t, lang: i18n.language });
      else {
        const f = alf.applied;
        const blob = await getAccountLedgerPdf(f.subAccountId || f.accountId, {
          companyId, from: f.dateFrom, to: f.dateTo, costCenterId: f.costCenterId,
          departmentId: f.departmentId, branchId: f.branchId, lang: i18n.language,
        });
        saveLedgerBlob(blob, `Account-Ledger-${ledger.account.code}.pdf`);
      }
    } catch (err) { setError(err.message); }
    finally { setExporting(false); }
  }

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
            </form>
            {(alf.applied.subAccountId || alf.applied.accountId) && (
              <DraftEntriesNotice
                companyId={companyId}
                accountId={alf.applied.subAccountId || alf.applied.accountId}
                branchId={alf.applied.branchId || undefined}
                dateFrom={alf.applied.dateFrom || undefined}
                dateTo={alf.applied.dateTo || undefined}
              />
            )}
          </div>

          {!alf.applied.accountId && <p className="empty">{t("accountLedger.selectPrompt")}</p>}
          {loading && <p className="empty">{t("common.loading")}</p>}

          {ledger && !loading && (
            <>
              <AccountLedgerDocument ledger={ledger} company={company} periodLabel={periodLabel} />
              <div className="account-ledger-actions no-print">
                <button className="btn-ghost" disabled={exporting} onClick={() => exportReport("excel")}>{t("accountLedger.design.excel")}</button>
                <button className="btn-ghost" onClick={() => setPrintOpen(true)}>{t("common.print")}</button>
                <button className="btn-primary" disabled={exporting} onClick={() => exportReport("pdf")}>{exporting ? t("common.loading") : t("common.printShell.downloadPdf")}</button>
              </div>
            </>
          )}
        </>
      )}

      {printOpen && ledger && (
        <AccountLedgerPrintModal
          onDownload={() => exportReport("pdf")}
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
