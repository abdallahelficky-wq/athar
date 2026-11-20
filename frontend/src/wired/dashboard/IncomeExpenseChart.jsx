import React, {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip,Legend} from 'recharts';
import {getIncomeExpenseTrend} from '../../api/dashboard';
import {fmt} from '../../legacy/constants';
import {CHART_GRID,CHART_AXIS,CHART_FONT,chartTooltipStyle} from './chartTheme';
import {DashCard,compactNumber} from './DashParts';

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
 const net=revenue-expense;
 return <DashCard span={8} tone="green" className="income-expense-chart" title={t('incomeExpense.title')} note={t('incomeExpense.period')}>
  {state.loading ? <p role="status">{t('dashboard.loading')}</p> : state.error ? <div role="alert">{t('incomeExpense.error')} <button className="ls-act" onClick={()=>setRetry(n=>n+1)}>{t('incomeExpense.retry')}</button></div> : <>
   <div className="income-expense-totals">
    <div className="ie-rev"><span>{t('incomeExpense.revenue')}</span><strong data-testid="revenue-total">{fmt(revenue)} {currency}</strong></div>
    <div className="ie-exp"><span>{t('incomeExpense.expense')}</span><strong data-testid="expense-total">{fmt(expense)} {currency}</strong></div>
    <div className={net>=0?'ie-net ie-net-up':'ie-net ie-net-down'}><span>{t('dashboard.screen.net')}</span><strong data-testid="net-total">{fmt(net)} {currency}</strong></div>
   </div>
   {!state.rows.some(row=>row.revenue!==0 || row.expense!==0) && <p>{t('incomeExpense.empty')}</p>}
   <div dir="ltr"><ResponsiveContainer width="100%" height={290}>
    <BarChart data={state.rows} margin={{top:12,right:12,bottom:8,left:0}} accessibilityLayer>
     <defs>
      <linearGradient id="ieRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1B8354"/><stop offset="100%" stopColor="#1B8354" stopOpacity={0.6}/></linearGradient>
      <linearGradient id="ieExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#A8432B"/><stop offset="100%" stopColor="#A8432B" stopOpacity={0.6}/></linearGradient>
     </defs>
     <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4"/>
     <XAxis dataKey="month" tickLine={false} tick={{fill:CHART_AXIS,fontSize:11,fontFamily:CHART_FONT}} minTickGap={24}/>
     <YAxis width={60} axisLine={false} tickLine={false} tick={{fill:CHART_AXIS,fontSize:11}} tickFormatter={compactNumber}/>
     <Tooltip {...chartTooltipStyle} cursor={{fill:'rgba(67,56,202,0.06)'}} formatter={v=>`${fmt(v)} ${currency}`}/><Legend wrapperStyle={{fontSize:12,fontFamily:CHART_FONT}}/>
     <Bar dataKey="revenue" name={t('incomeExpense.revenue')} fill="url(#ieRev)" radius={[6,6,0,0]} maxBarSize={30}/>
     <Bar dataKey="expense" name={t('incomeExpense.expense')} fill="url(#ieExp)" radius={[6,6,0,0]} maxBarSize={30}/>
    </BarChart>
   </ResponsiveContainer></div>
  </>}
 </DashCard>;
}
