import React, { useEffect, useState } from "react";
import { getTrialBalanceTree, getIncomeStatement, getBalanceSheet } from "../api/reports";
import { listAccounts } from "../api/accounts";
import { fmt } from "../legacy/constants";
import FinancialStatementPrintModal from "./FinancialStatementPrintModal";
import TrialBalanceTreePrintModal from "./TrialBalanceTreePrintModal";
import { Icon } from "../legacy/shared";
import Breadcrumb from "./shared/Breadcrumb";
import SubTabs from "./shared/SubTabs";
import ReportRollupFilter from "./shared/ReportRollupFilter";
import TrialBalanceView from "./TrialBalanceView";
import { collectGroupAccountIds, flattenVisibleTree } from "./shared/trialBalanceTree";
import { exportTrialBalanceExcel } from "./shared/exportTrialBalanceExcel";
import { useDeferredFilters } from "./shared/useDeferredFilters";
import ComprehensiveMonthlyReport from "./ComprehensiveMonthlyReport";

export const REPORT_TABS = [
  { id: "trial", label: "ميزان المراجعة" },
  { id: "income", label: "قائمة الدخل" },
  { id: "balance", label: "المركز المالي" },
  { id: "monthly", label: "التقرير المالي الشهري الشامل" },
];

/**
 * صفوف شجرة مبلغ واحد (إيراد/مصروف أو أصل/التزام/حقوق) — تُعرَض موسّعة بالكامل دائماً (بلا طي/فتح
 * يدوي كميزان المراجعة)، لأن "المستوى" هنا هو أداة التحكّم الوحيدة في عمق العرض، ونطاق كل قسم
 * أصلاً محدود بنوع الحساب فلا داعي لأداة طي إضافية. تُستخدَم لكل الأقسام الخمسة في الشاشتين.
 */
function AmountTreeRows({ nodes, depth = 0 }) {
  return nodes.map((node) => (
    <React.Fragment key={node.accountId}>
      <tr className={"tb-tree-row" + (!node.isPosting ? " tb-group" : "")}>
        <td style={{ paddingRight: 8 + depth * 22 }}>{node.code} — {node.name}</td>
        <td className="num">{fmt(node.amount)}</td>
      </tr>
      {node.children.length > 0 && <AmountTreeRows nodes={node.children} depth={depth + 1} />}
    </React.Fragment>
  ));
}

function IncomeStatementView({ data, accounts, filters }) {
  if (!data) return null;
  const { draft, setField, apply } = filters;
  return (
    <div className="panel">
      <h3>قائمة الدخل</h3>
      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label>من تاريخ<input type="date" value={draft.dateFrom} onChange={(e) => setField("dateFrom", e.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={draft.dateTo} onChange={(e) => setField("dateTo", e.target.value)} /></label>
        <ReportRollupFilter accounts={accounts} values={draft} onChange={setField} />
        <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>إظهار النتائج</button>
      </form>
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>الإيرادات</td></tr>
          <AmountTreeRows nodes={data.revenueRoots} />
          <tr><td className="strong">إجمالي الإيرادات</td><td className="num strong">{fmt(data.totalRevenue)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>المصروفات</td></tr>
          <AmountTreeRows nodes={data.expenseRoots} />
          <tr><td className="strong">إجمالي المصروفات</td><td className="num strong">{fmt(data.totalExpense)}</td></tr>

          <tr className="net-row"><td className="strong">صافي الربح</td><td className="num strong">{fmt(data.netIncome)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceSheetView({ data, accounts, filters }) {
  if (!data) return null;
  const { draft, setField, apply } = filters;
  return (
    <div className="panel">
      <h3>المركز المالي</h3>
      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label>حتى تاريخ<input type="date" value={draft.asOfDate} onChange={(e) => setField("asOfDate", e.target.value)} /></label>
        <ReportRollupFilter accounts={accounts} values={draft} onChange={setField} />
        <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>إظهار النتائج</button>
      </form>
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>الأصول</td></tr>
          <AmountTreeRows nodes={data.assetRoots} />
          <tr><td className="strong">إجمالي الأصول</td><td className="num strong">{fmt(data.totalAssets)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>الالتزامات</td></tr>
          <AmountTreeRows nodes={data.liabilityRoots} />
          <tr><td className="strong">إجمالي الالتزامات</td><td className="num strong">{fmt(data.totalLiabilities)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>حقوق الملكية</td></tr>
          <AmountTreeRows nodes={data.equityRoots} />
          <tr><td className="indent">صافي الربح (أرباح مرحّلة)</td><td className="num">{fmt(data.netIncome)}</td></tr>
          <tr><td className="strong">إجمالي حقوق الملكية</td><td className="num strong">{fmt(data.totalEquity)}</td></tr>

          <tr className="net-row">
            <td className="strong">إجمالي الالتزامات وحقوق الملكية</td>
            <td className={"num strong " + (data.balanced ? "balance-ok" : "balance-bad")}>
              {fmt(data.totalLiabilities + data.totalEquity)} {data.balanced ? "✓" : "⚠"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsModule({ companies, companyId, tab, setTab }) {
  const [accounts, setAccounts] = useState([]);
  const [incomeStatement, setIncomeStatement] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  // فلتر التجميع (مستوى/فرع معيّن/تفاصيل/بحث/تواريخ) — لقائمة الدخل والمركز المالي، تعرضان شجرة
  // هرمية لكل قسم (إيرادات/مصروفات أو أصول/التزامات/حقوق) مقصوصة عند المستوى المختار، بنفس منطق
  // truncateTreeDepth المستخدم في ميزان المراجعة. ميزان المراجعة له حالته الهرمية الخاصة أدناه.
  // "مؤجَّلة" (useDeferredFilters): القيم لا تُطبَّق فعلياً (لا يُعاد الجلب) إلا عند الضغط على
  // "إظهار النتائج" أو Enter — راجع تعليق الـ hook نفسه لتفاصيل السبب.
  const rollupFilters = useDeferredFilters({
    dateFrom: "", dateTo: "", asOfDate: new Date().toISOString().slice(0, 10),
    level: 4, accountId: "", includeDetails: false, search: "",
  });

  // حالة ميزان المراجعة الهرمي (Tree View) — مستقلة تماماً عن فلاتر التقريرين الآخرين، ومؤجَّلة
  // بنفس الطريقة.
  const [tbData, setTbData] = useState(null);
  const tb = useDeferredFilters({ dateFrom: "", dateTo: "", level: 4, hideZeroActivity: true, search: "" });
  const [tbExpandedIds, setTbExpandedIds] = useState(new Set());

  useEffect(() => {
    if (!companyId) return;
    listAccounts({ tree: true, companyId }).then(setAccounts).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const f = tb.applied;
    getTrialBalanceTree({
      companyId,
      from: f.dateFrom || undefined,
      to: f.dateTo || undefined,
      level: f.level,
      hideZeroActivity: f.hideZeroActivity || undefined,
      search: f.search || undefined,
    })
      .then((tree) => {
        setTbData(tree);
        // الشجرة تُفتح بالكامل افتراضياً عند كل تحميل جديد (تاريخ/فلتر مختلف قد يُظهر حسابات
        // جديدة لم تكن موسَّعة سابقاً)، فلا داعي لتذكّر حالة طي قديمة قد تُخفي نتائج جديدة.
        setTbExpandedIds(collectGroupAccountIds(tree.roots));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, tb.applied]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const f = rollupFilters.applied;
    const rollup = { level: f.level, accountId: f.accountId || undefined, includeDetails: f.includeDetails || undefined, search: f.search || undefined };
    Promise.all([
      getIncomeStatement({ companyId, from: f.dateFrom || undefined, to: f.dateTo || undefined, ...rollup }),
      getBalanceSheet({ companyId, date: f.asOfDate || undefined, ...rollup }),
    ])
      .then(([is, bs]) => {
        setIncomeStatement(is);
        setBalanceSheet(bs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, rollupFilters.applied]);

  const activeCompany = companies?.find((c) => c.id === companyId);
  const tbVisibleRows = tbData ? flattenVisibleTree(tbData.roots, tbExpandedIds) : [];

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["الإفصاح المالي", "بيانات حقيقية"]} />
        <h2>التقارير المالية الرئيسية</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {!companyId && tab !== "monthly" ? (
        <p className="empty">أنشئ شركة أولاً من لوحة القيادة لعرض تقاريرها المالية.</p>
      ) : loading ? (
        <p className="empty">جارٍ التحميل...</p>
      ) : (
        <>
          <SubTabs
            tabs={REPORT_TABS}
            active={tab}
            onChange={setTab}
            trailing={<button className="icon-btn" title="طباعة التقرير الحالي" onClick={() => setPrinting(true)}><Icon.Printer /></button>}
          />
          {tab === "monthly" && <ComprehensiveMonthlyReport companyId={companyId} />}
          {tab === "trial" && (
            <TrialBalanceView
              data={tbData}
              filters={tb}
              expandedIds={tbExpandedIds} setExpandedIds={setTbExpandedIds}
              onPrint={() => setPrinting(true)}
              onExportExcel={() => exportTrialBalanceExcel({
                visibleRows: tbVisibleRows,
                totals: tbData.totals,
                balanced: tbData.balanced,
                company: activeCompany,
                dateFrom: tb.applied.dateFrom,
                dateTo: tb.applied.dateTo,
              })}
            />
          )}
          {tab === "income" && (
            <IncomeStatementView data={incomeStatement} accounts={accounts} filters={rollupFilters} />
          )}
          {tab === "balance" && (
            <BalanceSheetView data={balanceSheet} accounts={accounts} filters={rollupFilters} />
          )}
        </>
      )}

      {printing && tab === "trial" && tbData && (
        <TrialBalanceTreePrintModal
          visibleRows={tbVisibleRows}
          totals={tbData.totals}
          balanced={tbData.balanced}
          dateFrom={tb.applied.dateFrom}
          dateTo={tb.applied.dateTo}
          company={activeCompany}
          onClose={() => setPrinting(false)}
        />
      )}
      {printing && tab !== "trial" && (
        <FinancialStatementPrintModal
          kind={tab}
          data={tab === "income" ? incomeStatement : balanceSheet}
          company={activeCompany}
          asOfDate={tab === "balance" ? rollupFilters.applied.asOfDate : rollupFilters.applied.dateTo}
          autoPrint={false}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
