import React from 'react';
import {useTranslation} from 'react-i18next';
import {ResponsiveContainer,PieChart,Pie,Cell,Tooltip} from 'recharts';
import {fmt} from '../legacy/constants';
import {currencyLabel} from '../shared/countries';
export default function TrialBalanceSummary({summary:s,company,compact=false}) {
 const {t,i18n}=useTranslation();
 if(!s)return null;
 const currency=currencyLabel(company?.currency,i18n.language);
 const balance=[{key:'assets',value:s.assets,color:'#16a34a'},{key:'liabilities',value:s.liabilities,color:'#c8102e'},{key:'equity',value:s.equity,color:'#2563eb'}];
 const total=balance.reduce((n,r)=>n+Math.abs(r.value),0);
 const max=Math.max(Math.abs(s.revenue),Math.abs(s.expense),1);
 return <>
  <div className="trial-summary-grid">
   {[...balance,{key:'netIncome',value:s.netIncome,color:s.netIncome<0?'#c8102e':'#b8860b'}].map(r=><article key={r.key} className="trial-summary-card" style={{borderTopColor:r.color}}>
    <span>{t(`trialDesign.${r.key}`)}</span><strong data-testid={`trial-${r.key}`} style={{color:r.key==='netIncome'?r.color:undefined}}>{fmt(r.value)} <small>{currency}</small></strong>
    <small>{t(r.key==='netIncome'?'trialDesign.periodResult':'trialDesign.closing')}</small>
   </article>)}
  </div>
  {!compact && <><div className="trial-charts">
   <section className="trial-chart"><h3>{t('trialDesign.distribution')}</h3><p>{t('trialDesign.distributionNote')}</p>
    <div className="trial-distribution">
     {total>0 ? <ResponsiveContainer width="45%" height={180}><PieChart><Pie data={balance.map(r=>({...r,value:Math.abs(r.value),name:t(`trialDesign.${r.key}`)}))} dataKey="value" innerRadius={45} outerRadius={70} isAnimationActive={false}>{balance.map(r=><Cell key={r.key} fill={r.color}/>)}</Pie><Tooltip formatter={v=>`${fmt(v)} ${currency}`}/></PieChart></ResponsiveContainer>:<p>{t('reports.trial.empty')}</p>}
     <div>{balance.map(r=><p key={r.key}><span style={{color:r.color}}>●</span> {t(`trialDesign.${r.key}`)} <strong>{fmt(r.value)}</strong></p>)}</div>
    </div>
   </section>
   <section className="trial-chart"><h3>{t('trialDesign.analysis')}</h3><p>{t('trialDesign.expenseNote')}</p>
    {['revenue','expense'].map(key=><div className="trial-bar" key={key}><div><span>{t(`trialDesign.${key}`)}</span><strong>{fmt(s[key])} {currency}</strong></div><div className="trial-bar-track"><div style={{width:`${Math.abs(s[key])/max*100}%`,background:key==='revenue'?'#d4af37':'#c8102e'}}/></div></div>)}
   </section>
  </div>
  <section className="trial-profit"><div><strong>{t('trialDesign.netIncome')}</strong><p>{t('trialDesign.formula')}</p></div><strong style={{color:s.netIncome<0?'#fda4af':'#86efac'}}>{fmt(s.netIncome)} <small>{currency}</small></strong></section>
 </>}
 </>;
}
