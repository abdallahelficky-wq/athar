import React from 'react';
import { useTranslation } from 'react-i18next';
import { fmt } from '../legacy/constants';
import { currencyLabel } from '../shared/countries';
import '../styles/trial-balance.css';

/**
 * بطاقات ملخّص قائمة الدخل بنفس تصميم ملخّص ميزان المراجعة: الإيرادات، تكلفة المبيعات، مجمل الربح، المصروفات
 * التشغيلية، صافي الربح (الخسارة) — نفس أرقام القائمة متعددة المراحل أسفلها. في المقارنة (عدة فترات) تعرض مجموع
 * الفترات المعروضة — فترات متتالية لا تتداخل، فمجموعها = قائمة دخل المدى كله، والهوامش من المجاميع لا متوسط هوامش.
 */
export default function IncomeStatementSummary({ result, company, print = false }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(company?.currency, i18n.language);
  const sum = key => result.statements.reduce((n, s) => n + Number(s[key] || 0), 0);
  const multi = result.periods.length > 1;
  const revenue = sum('salesRevenue');
  const gross = sum('grossProfit');
  const net = sum('netIncome');
  const pct = v => (Math.abs(revenue) < 0.005 ? '—' : `${((v / revenue) * 100).toFixed(1)}%`);
  const note = multi ? t('reports.income.summary.periodsTotal', { count: result.periods.length }) : t('reports.income.summary.periodTotal');
  const cards = [
    { key: 'revenue', label: t('reports.income.totalRevenue'), value: revenue, color: '#16a34a', note },
    { key: 'cogs', label: t('reports.income.totalCostOfSales'), value: sum('totalCostOfSales'), color: '#64748b', note },
    { key: 'gross', label: t('reports.income.grossProfit'), value: gross, color: gross < 0 ? '#c8102e' : '#0f766e', note: `${t('reports.income.grossMargin')}: ${pct(gross)}`, emphasis: true },
    { key: 'opex', label: t('reports.income.totalOperatingExpenses'), value: sum('totalOperatingExpenses'), color: '#c8102e', note },
    { key: 'net', label: t('reports.income.netIncomeLoss'), value: net, color: net < 0 ? '#c8102e' : '#b8860b', note: `${t('reports.income.netMargin')}: ${pct(net)}`, emphasis: true },
  ];
  return <div className={print ? 'trial-print-summary' : undefined}>
    <div className="trial-summary-grid" style={{ gridTemplateColumns: print ? 'repeat(5, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {cards.map(c => <article key={c.key} className="trial-summary-card" style={{ borderTopColor: c.color }}>
        <span>{c.label}</span>
        <strong data-testid={`income-${c.key}`} style={{ color: c.emphasis ? c.color : undefined }}>{fmt(c.value)} <small>{currency}</small></strong>
        <small><span dir="auto">{c.note}</span></small>
      </article>)}
    </div>
  </div>;
}
