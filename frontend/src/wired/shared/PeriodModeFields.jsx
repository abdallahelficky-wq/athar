import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * حقول اختيار الفترة المشتركة بين تقارير الفترات (التحليل المالي، التدفقات النقدية، تقارير المبيعات والمشتريات
 * والمخزون): فترة يدوية، فترة مقابل نفس الفترة من العام السابق، هذا الشهر، مقارنة أشهر/أرباع/سنوات.
 * تُحوَّل إلى فترات فعلية بـ incomePeriods (incomePeriods.mjs) مع شهر بداية السنة المالية للشركة.
 * modes يقصر الخيارات لتقرير لا تناسبه المقارنة.
 */
export const ALL_PERIOD_MODES = ['period', 'yoy', 'month', 'months', 'quarters', 'years'];

export default function PeriodModeFields({ draft, setField, startMonth = 1, modes = ALL_PERIOD_MODES }) {
  const { t } = useTranslation();
  return <>
    <label>{t('reports.periods.view')}<select value={draft.mode} onChange={(e) => setField('mode', e.target.value)}>
      {modes.map((m) => <option key={m} value={m}>{t(`reports.periods.modes.${m}`)}</option>)}
    </select></label>
    {['period', 'yoy'].includes(draft.mode) && <>
      <label>{t('reports.income.fromDate')}<input required type="date" value={draft.dateFrom} max={draft.dateTo} onChange={(e) => setField('dateFrom', e.target.value)} /></label>
      <label>{t('reports.income.toDate')}<input required type="date" value={draft.dateTo} min={draft.dateFrom} onChange={(e) => setField('dateTo', e.target.value)} /></label>
    </>}
    {['months', 'quarters'].includes(draft.mode) && <label>{t('reports.periods.endMonth')}<input required type="month" value={draft.endMonth} onChange={(e) => setField('endMonth', e.target.value)} /></label>}
    {draft.mode === 'years' && <label>{startMonth === 1 ? t('reports.periods.endYear') : t('reports.periods.endFiscalYear')}<input required type="number" min="1911" max="9999" value={draft.endYear} onChange={(e) => setField('endYear', e.target.value)} /></label>}
    {['months', 'quarters', 'years'].includes(draft.mode) && <label>{t('reports.periods.count')}<select value={draft.count} onChange={(e) => setField('count', Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>}
  </>;
}
