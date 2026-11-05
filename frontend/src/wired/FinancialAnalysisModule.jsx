import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFinancialAnalysis } from '../api/reports';
import { fmt } from '../legacy/constants';
import { PrintShell } from '../legacy/shared';
import { useDeferredFilters } from './shared/useDeferredFilters';
import { getAccountDisplayName } from './shared/accountDisplayName';
import { incomeDefaults, incomePeriods } from './shared/incomePeriods.mjs';

const GROUPS = ['liquidity', 'profitability', 'activity', 'leverage'];
const FIGURES = [
  ['flow', 'revenue'], ['flow', 'costOfSales'], ['flow', 'grossProfit'], ['flow', 'ebitda'], ['flow', 'netIncome'],
  ['closing', 'cash'], ['closing', 'receivables'], ['closing', 'inventory'], ['closing', 'currentAssets'], ['closing', 'totalAssets'],
  ['closing', 'currentLiabilities'], ['closing', 'totalLiabilities'], ['closing', 'equity'],
];

// مرجع عام فقط (يُذكر في الشاشة): نطاقات شائعة في التحليل المالي، لا معيار قطاعي
const STATUS_RULES = {
  currentRatio: (v) => (v >= 1.5 ? 'good' : v >= 1 ? 'watch' : 'weak'),
  quickRatio: (v) => (v >= 1 ? 'good' : v >= 0.7 ? 'watch' : 'weak'),
  netMargin: (v) => (v >= 0.1 ? 'good' : v >= 0 ? 'watch' : 'weak'),
  returnOnEquity: (v) => (v >= 0.15 ? 'good' : v >= 0 ? 'watch' : 'weak'),
  debtToEquity: (v) => (v <= 1 ? 'good' : v <= 2 ? 'watch' : 'weak'),
  interestCoverage: (v) => (v >= 3 ? 'good' : v >= 1.5 ? 'watch' : 'weak'),
};
const STATUS_COLOR = { good: 'var(--success, #15803d)', watch: 'var(--warning, #b45309)', weak: 'var(--danger, #b91c1c)' };

function formatRatio(value, unit, t) {
  if (value === null || value === undefined) return '—';
  if (unit === 'percent') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'days') return `${Math.round(value)} ${t('reports.analysis.days')}`;
  if (unit === 'amount') return fmt(value);
  return `${value.toFixed(2)}×`;
}

function AnalysisTables({ result }) {
  const { t, i18n } = useTranslation();
  const { periods, analyses } = result;
  const last = analyses.at(-1);
  const previous = analyses.length > 1 ? analyses.at(-2) : null;
  const head = <thead><tr><th>{t('reports.analysis.column.indicator')}</th>{periods.map((p) => <th key={p.from}><span dir="ltr">{p.label}</span></th>)}{previous && <th>{t('reports.analysis.column.change')}</th>}<th className="no-print">{t('reports.analysis.column.formula')}</th></tr></thead>;
  return <>
    {last.warnings.map((w) => <p key={w} role="alert" className="balance-bad">{t(`reports.analysis.warnings.${w}`)}</p>)}
    <div style={{ overflowX: 'auto' }}>
      <table className="ledger-table voucher-table">
        {head}
        <tbody>
          {GROUPS.map((group) => <React.Fragment key={group}>
            <tr><td className="strong section-row" colSpan={periods.length + 3}>{t(`reports.analysis.groups.${group}`)}</td></tr>
            {last.ratios.filter((r) => r.group === group).map((r) => {
              const values = analyses.map((a) => a.ratios.find((x) => x.key === r.key)?.value ?? null);
              const status = r.value !== null && STATUS_RULES[r.key] ? STATUS_RULES[r.key](r.value) : null;
              const prev = values.length > 1 ? values.at(-2) : null;
              const delta = prev !== null && r.value !== null ? r.value - prev : null;
              return <tr key={r.key}>
                <td>{t(`reports.analysis.ratios.${r.key}`)}{status && <span style={{ color: STATUS_COLOR[status], marginInlineStart: 6, fontSize: 12 }}>● {t(`reports.analysis.status.${status}`)}</span>}</td>
                {values.map((v, i) => <td className="num" key={i}><span dir="ltr">{formatRatio(v, r.unit, t)}</span></td>)}
                {previous && <td className="num" dir="ltr">{delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatRatio(delta, r.unit, t)}`}</td>}
                <td className="no-print" style={{ fontSize: 12, opacity: 0.8 }}>{t(`reports.analysis.formulas.${r.key}`)}</td>
              </tr>;
            })}
          </React.Fragment>)}
        </tbody>
      </table>
    </div>
    <p style={{ fontSize: 12 }}>{t('reports.analysis.statusNote')}</p>

    <h4>{t('reports.analysis.figures.title')}</h4>
    <div style={{ overflowX: 'auto' }}>
      <table className="ledger-table voucher-table">
        <thead><tr><th>{t('reports.analysis.column.indicator')}</th>{periods.map((p) => <th key={p.from}><span dir="ltr">{p.label}</span></th>)}</tr></thead>
        <tbody>
          {FIGURES.map(([part, key]) => <tr key={key}><td>{t(`reports.analysis.figures.${key}`)}</td>{analyses.map((a, i) => <td className="num" key={i}>{fmt(a[part][key])}</td>)}</tr>)}
        </tbody>
      </table>
    </div>

    {last.unclassifiedAccounts.length > 0 && <>
      <h4>{t('reports.analysis.unclassified.title')}</h4>
      <p style={{ fontSize: 12 }}>{t('reports.analysis.unclassified.hint')}</p>
      <table className="ledger-table">
        <tbody>{last.unclassifiedAccounts.map((a) => <tr key={a.accountId}><td>{a.code} — {getAccountDisplayName(a, i18n.language)}</td><td className="num">{fmt(a.amount)}</td></tr>)}</tbody>
      </table>
    </>}
    <p style={{ fontSize: 12, opacity: 0.8 }}>{t('reports.analysis.limits')}</p>
  </>;
}

export default function FinancialAnalysisModule({ companyId, company, printing, onClosePrint }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const text = (arabic, english) => (ar ? arabic : english);
  const startMonth = company?.fiscalYearStartMonth || 1;
  const { draft, applied, setField, apply } = useDeferredFilters(incomeDefaults(new Date(), startMonth));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError('');
    if (!companyId) return undefined;
    let periods;
    try { periods = incomePeriods(applied, new Date(), startMonth); } catch { setError('INVALID_PERIOD'); return undefined; }
    setLoading(true);
    (async () => {
      const analyses = [];
      for (let i = 0; i < periods.length; i += 3) {
        if (cancelled) return;
        analyses.push(...await Promise.all(periods.slice(i, i + 3).map((p) => getFinancialAnalysis({ companyId, from: p.from, to: p.to }))));
      }
      if (!cancelled) setResult({ periods, analyses });
    })().catch((err) => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, applied, startMonth]);

  return <div className="panel">
    <h3>{t('reports.analysis.title')}</h3>
    <p style={{ fontSize: 13 }}>{t('reports.analysis.intro')}</p>
    <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); onClosePrint?.(); apply(); }}>
      <label>{text('طريقة العرض', 'View')}<select value={draft.mode} onChange={(e) => setField('mode', e.target.value)}>
        <option value="period">{text('فترة محددة', 'Date range')}</option>
        <option value="yoy">{text('فترة محددة مقابل نفس الفترة من العام السابق', 'Date range vs. same period last year')}</option>
        <option value="month">{text('هذا الشهر حتى اليوم', 'This month to date')}</option>
        <option value="months">{text('مقارنة أشهر', 'Compare months')}</option>
        <option value="quarters">{text('مقارنة أرباع', 'Compare quarters')}</option>
        <option value="years">{text('مقارنة سنوات', 'Compare years')}</option>
      </select></label>
      {['period', 'yoy'].includes(draft.mode) && <>
        <label>{t('reports.income.fromDate')}<input required type="date" value={draft.dateFrom} max={draft.dateTo} onChange={(e) => setField('dateFrom', e.target.value)} /></label>
        <label>{t('reports.income.toDate')}<input required type="date" value={draft.dateTo} min={draft.dateFrom} onChange={(e) => setField('dateTo', e.target.value)} /></label>
      </>}
      {['months', 'quarters'].includes(draft.mode) && <label>{text('حتى شهر', 'Ending month')}<input required type="month" value={draft.endMonth} onChange={(e) => setField('endMonth', e.target.value)} /></label>}
      {draft.mode === 'years' && <label>{startMonth === 1 ? text('حتى سنة', 'Ending year') : text('حتى السنة المالية التي تبدأ في', 'Ending fiscal year starting in')}<input required type="number" min="1911" max="9999" value={draft.endYear} onChange={(e) => setField('endYear', e.target.value)} /></label>}
      {['months', 'quarters', 'years'].includes(draft.mode) && <label>{text('عدد الفترات', 'Number of periods')}<select value={draft.count} onChange={(e) => setField('count', Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>}
      <button type="submit" className="btn-primary" style={{ alignSelf: 'end' }}>{t('reports.income.showResults')}</button>
    </form>
    {error && <p role="alert" className="balance-bad">{error === 'INVALID_PERIOD' ? text('راجع التواريخ وعدد الفترات.', 'Check the dates and number of periods.') : error}</p>}
    {loading && <p role="status">{t('common.loading')}</p>}
    {result && <>
      <AnalysisTables result={result} />
      {printing && <PrintShell company={company} subtitle={t('reports.analysis.title')} landscape={result.periods.length > 2} refNode={<span dir="ltr">{result.periods[0].from} — {result.periods.at(-1).to}</span>} onClose={onClosePrint}><AnalysisTables result={result} /></PrintShell>}
    </>}
  </div>;
}
