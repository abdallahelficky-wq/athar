import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * فلتر فترة بسيط لتقارير المستندات (المبيعات، المشتريات، المخزون): من/إلى بأيام كاملة بتوقيت الرياض في الخادم
 * (src/lib/reportFilters.ts). فارغان = كل المدة. القيم لا تُطبَّق إلا عند "إظهار النتائج" حتى لا يُعاد الجلب مع كل حرف.
 * اختصارات للفترات الشائعة: هذا الشهر، الشهر السابق، هذا الربع، هذه السنة.
 */
const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function quickRange(kind, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (kind === 'thisMonth') return { from: day(new Date(y, m, 1)), to: day(new Date(y, m + 1, 0)) };
  if (kind === 'lastMonth') return { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) };
  if (kind === 'thisQuarter') { const q = Math.floor(m / 3) * 3; return { from: day(new Date(y, q, 1)), to: day(new Date(y, q + 3, 0)) }; }
  if (kind === 'thisYear') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: '', to: '' };
}

export default function DateRangeBar({ value, onApply, children }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  return <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); onApply(draft); }}>
    <label>{t('reports.income.fromDate')}<input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
    <label>{t('reports.income.toDate')}<input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
    <label>{t('reports.range.quick')}<select value="" onChange={(e) => { const r = { ...draft, ...quickRange(e.target.value) }; setDraft(r); onApply(r); }}>
      <option value="">—</option>
      {['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'all'].map((k) => <option key={k} value={k}>{t(`reports.range.${k}`)}</option>)}
    </select></label>
    {children?.(draft, setDraft)}
    <button type="submit" className="btn-primary" style={{ alignSelf: 'end' }}>{t('reports.income.showResults')}</button>
  </form>;
}
