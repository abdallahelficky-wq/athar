import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBalanceSheet } from '../api/reports';
import { fmt } from '../legacy/constants';
import { PrintShell } from '../legacy/shared';
import { useDeferredFilters } from './shared/useDeferredFilters';
import { getAccountDisplayName } from './shared/accountDisplayName';
import { incomeDefaults, incomePeriods, incomeComparisonTree } from './shared/incomePeriods.mjs';
import PeriodModeFields from './shared/PeriodModeFields';

/**
 * المركز المالي المقارن: عمود لكل فترة بأرصدة آخر يوم فيها، من نفس /reports/balance-sheet. الدمج بمعرّف الحساب
 * الثابت (incomeComparisonTree). المستوى من نفس فلتر المركز المالي في التبويب.
 */
const MODES = ['yoy', 'months', 'quarters', 'years'];
const SECTIONS = [['assetRoots', 'assets', 'totalAssets'], ['liabilityRoots', 'liabilities', 'totalLiabilities'], ['equityRoots', 'equity', null]];

function Rows({ nodes, lang, depth = 0 }) {
  return nodes.map((node) => <React.Fragment key={node.accountId}>
    <tr className={'tb-tree-row' + (!node.isPosting ? ' tb-group' : '')}>
      <td style={{ paddingInlineStart: 8 + depth * 22 }}>{node.code} — {getAccountDisplayName(node, lang)}</td>
      {node.amounts.map((a, i) => <td className="num" key={i}>{fmt(a)}</td>)}
    </tr>
    <Rows nodes={node.children} lang={lang} depth={depth + 1} />
  </React.Fragment>);
}

function ComparisonTable({ result }) {
  const { t, i18n } = useTranslation();
  const { periods, sheets } = result;
  const total = (label, values, className = '') => <tr className={className}><td className="strong">{label}</td>{values.map((v, i) => <td className="num strong" key={i}>{fmt(v)}</td>)}</tr>;
  const change = sheets.length > 1 ? sheets.at(-1).totalAssets - sheets.at(-2).totalAssets : null;
  return <div style={{ overflowX: 'auto' }}>
    <table className="ledger-table voucher-table" style={{ fontSize: periods.length > 6 ? 10 : undefined }}>
      <thead><tr><th>{t('reports.trial.table.account')}</th>{periods.map((p) => <th key={p.to}><span dir="ltr">{p.to}</span></th>)}</tr></thead>
      <tbody>
        {SECTIONS.map(([key, label, totalKey]) => <React.Fragment key={key}>
          <tr><td className="strong section-row" colSpan={periods.length + 1}>{t(`reports.balance.${label}`)}</td></tr>
          <Rows nodes={incomeComparisonTree(sheets, key)} lang={i18n.language} />
          {key === 'equityRoots' && <tr><td className="indent">{t('reports.balance.retainedEarnings')}</td>{sheets.map((s, i) => <td className="num" key={i}>{fmt(s.netIncome)}</td>)}</tr>}
          {totalKey ? total(t(`reports.balance.${totalKey}`), sheets.map((s) => s[totalKey])) : total(t('reports.balance.totalEquity'), sheets.map((s) => s.totalEquity))}
        </React.Fragment>)}
        {total(t('reports.balance.totalLiabEquity'), sheets.map((s) => s.totalLiabilities + s.totalEquity), 'net-row')}
      </tbody>
    </table>
    {change !== null && <p style={{ fontSize: 12 }}>{t('reports.balanceComparison.assetsChange')}: <span dir="ltr">{change > 0 ? '+' : ''}{fmt(change)}</span></p>}
  </div>;
}

export default function BalanceComparisonModule({ companyId, company, rollup }) {
  const { t } = useTranslation();
  const startMonth = company?.fiscalYearStartMonth || 1;
  const { draft, applied, setField, apply } = useDeferredFilters({ ...incomeDefaults(new Date(), startMonth), mode: 'months' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  // طباعة مستقلة عن زر طباعة التبويب (الذي يطبع المركز المالي في تاريخ واحد)
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError('');
    if (!companyId || !open) return undefined;
    let periods;
    try { periods = incomePeriods(applied, new Date(), startMonth); } catch { setError('INVALID_PERIOD'); return undefined; }
    setLoading(true);
    (async () => {
      const sheets = [];
      for (let i = 0; i < periods.length; i += 3) {
        if (cancelled) return;
        sheets.push(...await Promise.all(periods.slice(i, i + 3).map((p) => getBalanceSheet({ companyId, date: p.to, ...rollup }))));
      }
      if (!cancelled) setResult({ periods, sheets });
    })().catch((err) => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, applied, startMonth, open, JSON.stringify(rollup)]);

  return <div className="panel">
    <h3>{t('reports.balanceComparison.title')}</h3>
    <p style={{ fontSize: 13 }}>{t('reports.balanceComparison.hint')}</p>
    <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); setOpen(true); setPrinting(false); apply(); }}>
      <PeriodModeFields draft={draft} setField={setField} startMonth={startMonth} modes={MODES} />
      <button type="submit" className="btn-primary" style={{ alignSelf: 'end' }}>{t('reports.income.showResults')}</button>
      {result && <button type="button" className="btn-secondary" style={{ alignSelf: 'end' }} onClick={() => setPrinting(true)}>{t('reports.printCurrent')}</button>}
    </form>
    {error && <p role="alert" className="balance-bad">{error === 'INVALID_PERIOD' ? t('reports.periods.invalid') : error}</p>}
    {loading && <p role="status">{t('common.loading')}</p>}
    {result && <>
      <ComparisonTable result={result} />
      {printing && <PrintShell company={company} subtitle={t('reports.balanceComparison.title')} landscape={result.periods.length > 2} refNode={<span dir="ltr">{result.periods.map((p) => p.to).join(' | ')}</span>} onClose={() => setPrinting(false)}><ComparisonTable result={result} /></PrintShell>}
    </>}
  </div>;
}
