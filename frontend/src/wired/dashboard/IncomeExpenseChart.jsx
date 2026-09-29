import React, {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip,Legend} from 'recharts';
import {getIncomeExpenseTrend} from '../../api/dashboard';
import {fmt} from '../../legacy/constants';
import {CHART_GRID,CHART_AXIS,CHART_FONT,chartTooltipStyle} from './chartTheme';

export default function IncomeExpenseChart({companyId,currency}) {
 const {t}=useTranslation();
 const [state,setState]=useState({rows:[],loading:true,error:false});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;
  setState({rows:[],loading:true,error:false});
  getIncomeExpenseTrend(companyId).then(rows=>{if(active)setState({rows,loading:false,error:false});})
   .catch(()=>{if(active)setState({rows:[],loading:false,error:true});});
  return ()=>{active=false;};
 },[companyId,retry]);
 const revenue=state.rows.reduce((sum,row)=>sum+row.revenue,0);
 const expense=state.rows.reduce((sum,row)=>sum+row.expense,0);
 return <section className="panel chart-panel income-expense-chart" aria-label={t('incomeExpense.title')}>
  <h3>{t('incomeExpense.title')}</h3>
  <p className="empty">{t('incomeExpense.period')}</p>
  {state.loading ? <p role="status">{t('dashboard.loading')}</p> : state.error ? <div role="alert">{t('incomeExpense.error')} <button className="btn-ghost" onClick={()=>setRetry(n=>n+1)}>{t('incomeExpense.retry')}</button></div> : <>
   <div className="income-expense-totals">
    <div><span>{t('incomeExpense.revenue')}</span><strong data-testid="revenue-total">{fmt(revenue)} {currency}</strong></div>
    <div><span>{t('incomeExpense.expense')}</span><strong data-testid="expense-total">{fmt(expense)} {currency}</strong></div>
   </div>
   {!state.rows.some(row=>row.revenue!==0 || row.expense!==0) && <p>{t('incomeExpense.empty')}</p>}
   <div dir="ltr"><ResponsiveContainer width="100%" height={290}>
    <BarChart data={state.rows} margin={{top:12,right:12,bottom:8,left:12}} accessibilityLayer>
     <CartesianGrid stroke={CHART_GRID} vertical={false}/>
     <XAxis dataKey="month" tick={{fill:CHART_AXIS,fontSize:11,fontFamily:CHART_FONT}} minTickGap={24}/>
     <YAxis width={65} tick={{fill:CHART_AXIS,fontSize:11}} tickFormatter={v=>new Intl.NumberFormat('en',{notation:'compact'}).format(v)}/>
     <Tooltip {...chartTooltipStyle} formatter={v=>`${fmt(v)} ${currency}`}/><Legend/>
     <Bar dataKey="revenue" name={t('incomeExpense.revenue')} fill="#2F5D5A" radius={[4,4,0,0]} maxBarSize={34}/>
     <Bar dataKey="expense" name={t('incomeExpense.expense')} fill="#A8432B" radius={[4,4,0,0]} maxBarSize={34}/>
    </BarChart>
   </ResponsiveContainer></div>
  </>}
 </section>;
}
