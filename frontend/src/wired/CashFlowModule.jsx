import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCashFlow } from '../api/reports';
import { fmt } from '../legacy/constants';
import { PrintShell } from '../legacy/shared';
import { useDeferredFilters } from './shared/useDeferredFilters';
import { getAccountDisplayName } from './shared/accountDisplayName';
import { incomeDefaults, incomePeriods } from './shared/incomePeriods.mjs';
import PeriodModeFields from './shared/PeriodModeFields';

const SECTIONS = ['operating', 'investing', 'financing'];

/** يدمج صفوف قسم عبر الفترات بمعرّف المجموعة الثابت (لا بالاسم) — صف يظهر إن كان له مبلغ في أي فترة */
function mergeRows(statements, section) {
  const rows = new Map();
  statements.forEach((s, i) => s[section].rows.forEach((r) => {
    if (!rows.has(r.groupId)) rows.set(r.groupId, { ...r, amounts: Array(statements.length).fill(0) });
    const row = rows.get(r.groupId);
    row.amounts[i] = r.amount;
    row.unclassified ||= r.unclassified;
  }));
  return [...rows.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

function CashFlowTable({ result }) {
  const { t, i18n } = useTranslation();
  const { periods, statements } = result;
  const line = (label, values, className = '') => <tr className={className}><td className={className.includes('strong') ? 'strong' : 'indent'}>{label}</td>{values.map((v, i) => <td className={'num ' + className} key={i}>{fmt(v)}</td>)}</tr>;
  const anyDifference = statements.some((s) => Math.abs(s.difference) >= 0.01);
  const anyUnclassified = statements.some((s) => s.operating.rows.some((r) => r.unclassified));
  return <>
    {anyUnclassified && <p role="alert" className="balance-bad">{t('reports.cashFlow.unclassifiedWarning')}</p>}
    <div style={{ overflowX: 'auto' }}>
      <table className="ledger-table voucher-table">
        <thead><tr><th>{t('reports.analysis.column.indicator')}</th>{periods.map((p) => <th key={p.from}><span dir="ltr">{p.label}</span></th>)}</tr></thead>
        <tbody>
          {SECTIONS.map((section) => <React.Fragment key={section}>
            <tr><td className="strong section-row" colSpan={periods.length + 1}>{t(`reports.cashFlow.sections.${section}`)}</td></tr>
            {section === 'operating' && line(t('reports.cashFlow.netIncome'), statements.map((s) => s.netIncome))}
            {section === 'operating' && line(t('reports.cashFlow.addDepreciation'), statements.map((s) => s.depreciation))}
            {mergeRows(statements, section).map((r) => <tr key={r.groupId}>
              <td className="indent">{r.code} — {getAccountDisplayName(r, i18n.language)}{r.unclassified && ' ⚠'}</td>
              {r.amounts.map((v, i) => <td className="num" key={i}>{fmt(v)}</td>)}
            </tr>)}
            {section === 'investing' && line(t('reports.cashFlow.lessDepreciation'), statements.map((s) => -s.depreciation))}
            {line(t(`reports.cashFlow.totals.${section}`), statements.map((s) => s[section].total), 'strong')}
          </React.Fragment>)}
          {line(t('reports.cashFlow.netChange'), statements.map((s) => s.netChange), 'strong net-row')}
          {line(t('reports.cashFlow.openingCash'), statements.map((s) => s.openingCash))}
          {line(t('reports.cashFlow.closingCash'), statements.map((s) => s.closingCash), 'strong')}
          {anyDifference && line(t('reports.cashFlow.difference'), statements.map((s) => s.difference), 'balance-bad')}
        </tbody>
      </table>
    </div>
    <p style={{ fontSize: 12, opacity: 0.8 }}>{t('reports.cashFlow.note')}</p>
  </>;
}

export default function CashFlowModule({ companyId, company, printing, onClosePrint }) {
  const { t } = useTranslation();
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
      const statements = [];
      for (let i = 0; i < periods.length; i += 3) {
        if (cancelled) return;
        statements.push(...await Promise.all(periods.slice(i, i + 3).map((p) => getCashFlow({ companyId, from: p.from, to: p.to }))));
      }
      if (!cancelled) setResult({ periods, statements });
    })().catch((err) => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, applied, startMonth]);

  return <div className="panel">
    <h3>{t('reports.cashFlow.title')}</h3>
    <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); onClosePrint?.(); apply(); }}>
      <PeriodModeFields draft={draft} setField={setField} startMonth={startMonth} />
      <button type="submit" className="btn-primary" style={{ alignSelf: 'end' }}>{t('reports.income.showResults')}</button>
    </form>
    {error && <p role="alert" className="balance-bad">{error === 'INVALID_PERIOD' ? t('reports.periods.invalid') : error}</p>}
    {loading && <p role="status">{t('common.loading')}</p>}
    {result && <>
      <CashFlowTable result={result} />
      {printing && <PrintShell company={company} subtitle={t('reports.cashFlow.title')} landscape={result.periods.length > 2} refNode={<span dir="ltr">{result.periods[0].from} — {result.periods.at(-1).to}</span>} onClose={onClosePrint}><CashFlowTable result={result} /></PrintShell>}
    </>}
  </div>;
}
