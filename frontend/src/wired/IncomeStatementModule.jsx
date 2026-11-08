import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getIncomeStatement } from '../api/reports';
import { fmt } from '../legacy/constants';
import { PrintShell } from '../legacy/shared';
import ReportRollupFilter from './shared/ReportRollupFilter';
import IncomeStatementSummary from './IncomeStatementSummary';
import DraftEntriesNotice from './shared/DraftEntriesNotice';
import { useDeferredFilters } from './shared/useDeferredFilters';
import { getAccountDisplayName } from './shared/accountDisplayName';
import { incomeDefaults, incomePeriods, incomeComparisonTree } from './shared/incomePeriods.mjs';

function Rows({ nodes, lang, depth = 0 }) {
  return nodes.map(node => <React.Fragment key={node.accountId}>
    <tr className={'tb-tree-row' + (!node.isPosting ? ' tb-group' : '')}>
      <td style={{ paddingInlineStart: 8 + depth * 22 }}>{node.code} — {getAccountDisplayName(node, lang)}</td>
      {node.amounts.map((amount, i) => <td className="num" key={i}>{fmt(amount)}</td>)}
    </tr>
    <Rows nodes={node.children} lang={lang} depth={depth + 1} />
  </React.Fragment>);
}

/**
 * قائمة الدخل متعددة المراحل: الإيرادات − تكلفة المبيعات = مجمل الربح − المصروفات التشغيلية = الربح التشغيلي
 * ± إيرادات ومصروفات أخرى وتكاليف التمويل = صافي الربح. الأقسام من تصنيف الحسابات (دورها في التحليل المالي).
 */
export function IncomeComparisonTable({ result }) {
  const { t, i18n } = useTranslation();
  const { periods, statements } = result;
  const cols = periods.length + 1;
  const total = (label, key, className = '') => <tr className={className}><td className="strong">{t(label)}</td>{statements.map((s, i) => <td className="num strong" key={i}>{fmt(s[key])}</td>)}</tr>;
  const margin = (label, key) => <tr><td className="indent" style={{ fontSize: 12 }}>{t(label)}</td>{statements.map((s, i) => <td className="num" style={{ fontSize: 12 }} key={i}><span dir="ltr">{s[key] === null || s[key] === undefined ? '—' : `${(s[key] * 100).toFixed(1)}%`}</span></td>)}</tr>;
  const section = (label) => <tr><td className="strong section-row" colSpan={cols}>{t(label)}</td></tr>;
  const hasOther = statements.some((s) => (s.otherRoots || []).length && Math.abs(s.otherNet) >= 0.005);
  const missingCogs = statements.some((s) => Math.abs(s.salesRevenue) >= 0.005 && Math.abs(s.totalCostOfSales) < 0.005);
  return <>
    {missingCogs && <p role="note" className="balance-bad" style={{ fontSize: 12 }}>{t('reports.income.noCostOfSalesHint')}</p>}
    <table className="ledger-table voucher-table" style={{ fontSize: periods.length > 6 ? 10 : undefined }}>
      <thead><tr><th>{t('reports.trial.table.account')}</th>{periods.map(p => <th key={p.from} style={{ minWidth: 65 }}><span dir="ltr">{p.label}</span></th>)}</tr></thead>
      <tbody>
        {section('reports.income.revenue')}
        <Rows nodes={incomeComparisonTree(statements, 'operatingRevenueRoots')} lang={i18n.language} />
        {total('reports.income.totalRevenue', 'salesRevenue')}
        {section('reports.income.costOfSales')}
        <Rows nodes={incomeComparisonTree(statements, 'costOfSalesRoots')} lang={i18n.language} />
        {total('reports.income.totalCostOfSales', 'totalCostOfSales')}
        {total('reports.income.grossProfit', 'grossProfit', 'net-row')}
        {margin('reports.income.grossMargin', 'grossMargin')}
        {section('reports.income.operatingExpenses')}
        <Rows nodes={incomeComparisonTree(statements, 'operatingExpenseRoots')} lang={i18n.language} />
        {total('reports.income.totalOperatingExpenses', 'totalOperatingExpenses')}
        {total('reports.income.operatingProfit', 'operatingProfit', 'net-row')}
        {hasOther && <>
          {section('reports.income.otherItems')}
          <Rows nodes={incomeComparisonTree(statements, 'otherRoots')} lang={i18n.language} />
          {total('reports.income.totalOtherItems', 'otherNet')}
        </>}
        {total('reports.income.netIncomeLoss', 'netIncome', 'net-row')}
        {margin('reports.income.netMargin', 'netMargin')}
      </tbody>
    </table>
  </>;
}

export default function IncomeStatementModule({ companyId, company, accounts, branches, printing, onClosePrint }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const text = (arabic, english) => ar ? arabic : english;
  const startMonth = company?.fiscalYearStartMonth || 1;
  const filters = useDeferredFilters(incomeDefaults(new Date(), startMonth));
  const { draft, applied, setField, apply } = filters;
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError('');
    setLoading(false);
    if (!companyId) return;
    let periods;
    try { periods = incomePeriods(applied, new Date(), startMonth); } catch { setError('INVALID_PERIOD'); return; }
    setLoading(true);
    const query = { companyId, level: applied.level, accountId: applied.accountId || undefined, includeDetails: applied.includeDetails || undefined, search: applied.search || undefined, branchId: applied.branchId || undefined };
    // Bound concurrency for a twelve-period comparison without changing report accounting rules.
    (async () => {
      const statements = [];
      for (let i = 0; i < periods.length; i += 3) {
        if (cancelled) return;
        statements.push(...await Promise.all(periods.slice(i, i + 3).map(p => getIncomeStatement({ ...query, from: p.from, to: p.to }))));
      }
      if (!cancelled) setResult({ periods, statements });
    })().catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, applied, startMonth]);
  return <div className="panel">
    <h3>{t('nav.tabs.income')}</h3>
    <form className="filter-bar" onSubmit={e => { e.preventDefault(); onClosePrint(); apply(); }}>
      <label>{text('طريقة العرض', 'View')}<select value={draft.mode} onChange={e => setField('mode', e.target.value)}>
        <option value="period">{text('فترة محددة', 'Date range')}</option><option value="month">{text('هذا الشهر حتى اليوم', 'This month to date')}</option>
        <option value="yoy">{text('فترة محددة مقابل نفس الفترة من العام السابق', 'Date range vs. same period last year')}</option>
        <option value="months">{text('مقارنة أشهر', 'Compare months')}</option><option value="quarters">{text('مقارنة أرباع', 'Compare quarters')}</option><option value="years">{text('مقارنة سنوات', 'Compare years')}</option>
      </select></label>
      {['period', 'yoy'].includes(draft.mode) && <>
        <label>{t('reports.income.fromDate')}<input required type="date" value={draft.dateFrom} max={draft.dateTo} onChange={e => setField('dateFrom', e.target.value)} /></label>
        <label>{t('reports.income.toDate')}<input required type="date" value={draft.dateTo} min={draft.dateFrom} onChange={e => setField('dateTo', e.target.value)} /></label>
      </>}
      {['months', 'quarters'].includes(draft.mode) && <label>{text('حتى شهر', 'Ending month')}<input required type="month" value={draft.endMonth} onChange={e => setField('endMonth', e.target.value)} /></label>}
      {draft.mode === 'years' && <label>{startMonth === 1 ? text('حتى سنة', 'Ending year') : text('حتى السنة المالية التي تبدأ في', 'Ending fiscal year starting in')}<input required type="number" min="1911" max="9999" value={draft.endYear} onChange={e => setField('endYear', e.target.value)} /></label>}
      {['months', 'quarters', 'years'].includes(draft.mode) && <label>{draft.mode === 'months' ? text('عدد الأشهر', 'Number of months') : draft.mode === 'quarters' ? text('عدد الأرباع', 'Number of quarters') : text('عدد السنوات', 'Number of years')}<select value={draft.count} onChange={e => setField('count', Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>}
      <ReportRollupFilter accounts={accounts} values={draft} onChange={setField} branches={branches} />
      <button type="submit" className="btn-primary" style={{ alignSelf: 'end' }}>{t('reports.income.showResults')}</button>
    </form>
    {error && <p role="alert" className="balance-bad">{error === 'INVALID_PERIOD' ? text('راجع التواريخ وعدد الفترات.', 'Check the dates and number of periods.') : error}</p>}
    {loading && <p role="status">{t('common.loading')}</p>}
    {result && <>
      <p>{text('تُخفى الحسابات الصفرية في جميع الفترات؛ تُحفظ مجموعات الحسابات التي تحتوي على أرصدة.', 'Accounts with zero balances in every period are hidden; groups containing balances are retained.')}</p>
      <DraftEntriesNotice companyId={companyId} branchId={applied.branchId || undefined} dateFrom={result.periods[0].from} dateTo={result.periods.at(-1).to} includeFinalDay />
      <IncomeStatementSummary result={result} company={company} />
      <div style={{ overflowX: 'auto' }}><IncomeComparisonTable result={result} /></div>
      {printing && <PrintShell company={company} subtitle={t('nav.tabs.income')} landscape={result.periods.length > 1} refNode={<span dir="ltr">{result.periods[0].from} — {result.periods.at(-1).to}</span>} onClose={onClosePrint}><IncomeStatementSummary result={result} company={company} print /><IncomeComparisonTable result={result} /></PrintShell>}
    </>}
  </div>;
}
