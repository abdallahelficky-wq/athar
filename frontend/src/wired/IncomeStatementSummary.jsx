import React from 'react';
import { useTranslation } from 'react-i18next';
import { fmt } from '../legacy/constants';
import { currencyLabel } from '../shared/countries';
import '../styles/trial-balance.css';

/**
 * بطاقات ملخّص قائمة الدخل بنفس تصميم ملخّص ميزان المراجعة: إجمالي الإيرادات، إجمالي المصروفات، صافي الربح (الخسارة).
 * في المقارنة (عدة أشهر/سنوات) تعرض مجموع الفترات المعروضة — فترات متتالية لا تتداخل، فمجموعها = قائمة دخل المدى كله.
 */
export default function IncomeStatementSummary({ result, company, print = false }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const text = (a, e) => (ar ? a : e);
  const currency = currencyLabel(company?.currency, i18n.language);
  const sum = key => result.statements.reduce((n, s) => n + Number(s[key] || 0), 0);
  const multi = result.periods.length > 1;
  const net = sum('netIncome');
  const note = multi ? text(`مجموع ${result.periods.length} فترات معروضة`, `Total of ${result.periods.length} periods shown`) : text('إجمالي الفترة المختارة', 'Total for the selected period');
  const cards = [
    { key: 'revenue', label: text('إجمالي الإيرادات', 'Total revenue'), value: sum('totalRevenue'), color: '#16a34a', note },
    { key: 'expense', label: text('إجمالي المصروفات', 'Total expenses'), value: sum('totalExpense'), color: '#c8102e', note },
    { key: 'net', label: text('صافي الربح / (الخسارة)', 'Net profit / (loss)'), value: net, color: net < 0 ? '#c8102e' : '#b8860b', note: text('نتيجة الفترة المختارة', 'Result for the selected period') },
  ];
  return <div className={print ? 'trial-print-summary' : undefined}>
    <div className="trial-summary-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      {cards.map(c => <article key={c.key} className="trial-summary-card" style={{ borderTopColor: c.color }}>
        <span>{c.label}</span>
        <strong data-testid={`income-${c.key}`} style={{ color: c.key === 'net' ? c.color : undefined }}>{fmt(c.value)} <small>{currency}</small></strong>
        <small>{c.note}</small>
      </article>)}
    </div>
  </div>;
}
