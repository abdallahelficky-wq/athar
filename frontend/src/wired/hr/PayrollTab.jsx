import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { listPayrollRuns, deletePayrollRun } from "../../api/payrollRuns";
import HRDialog from "./HRDialog";
import PayrollRunEditor from "./PayrollRunEditor";

export default function PayrollTab({ companyId, companies }) {
  const { i18n } = useTranslation(), ar = i18n.language.startsWith("ar"), L = (a,b) => ar ? a : b;
  const [params] = useSearchParams();
  const [runs,setRuns] = useState([]), [loading,setLoading] = useState(false), [error,setError] = useState("");
  const [month,setMonth] = useState(""), [status,setStatus] = useState(""), [opened,setOpened] = useState(null), [creating,setCreating] = useState(false);
  const [newMonth,setNewMonth] = useState(new Date().toISOString().slice(0,7)), [busy,setBusy] = useState(false);
  const reload = async () => { if (!companyId) return; setLoading(true); try { setRuns(await listPayrollRuns(companyId)); } catch(e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { setRuns([]); setOpened(null); setCreating(false); setError(""); let active=true; if(companyId) { setLoading(true); listPayrollRuns(companyId).then(data=>{if(active){setRuns(data);const linked=params.get("month");if(data.some(r=>r.month===linked))setOpened(linked);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);}); } return ()=>{active=false;}; },[companyId]);
  const remove = async r => {
    if (busy) return;
    if (!window.confirm(L("حذف مسودة مسير "+r.month+"؟ لا يمكن التراجع عن الحذف.","Delete payroll draft "+r.month+"? This cannot be undone."))) return;
    setBusy(true); setError(""); try { await deletePayrollRun(r.id); setOpened(null); await reload(); } catch(e) {setError(e.message);} finally{setBusy(false);}
  };
  const filtered=runs.filter(r=>(!month||r.month===month)&&(!status||r.status===status));
  if(!companyId)return null;
  return <div>
    <div className="hr-list-toolbar">
      <label>{L("الشهر","Month")}<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
      <label>{L("الحالة","Status")}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">{L("كل الحالات","All statuses")}</option><option value="draft">{L("مسودة","Draft")}</option><option value="posted">{L("مرحّل","Posted")}</option></select></label>
      <button className="btn-ghost" onClick={()=>{setMonth("");setStatus("");}}>{L("مسح الفلاتر","Clear filters")}</button>
      <button className="btn-primary" onClick={()=>setCreating(true)}>{L("+ مسير رواتب جديد","+ New payroll")}</button>
    </div>
    {error&&<p role="alert" className="balance-bad">{error}</p>}
    <div className="panel lines-table-wrap"><table className="ledger-table"><thead><tr><th>{L("المسير","Payroll")}</th><th>{L("الموظفون","Employees")}</th><th>{L("الحالة","Status")}</th><th>{L("الإجراءات","Actions")}</th></tr></thead><tbody>
    {filtered.map(r=><tr key={r.id}><td><button className="btn-ghost" onClick={()=>setOpened(r.month)}>{r.month}</button></td><td>{r.employeeIds.length}</td><td><span className="status-badge">{r.status==="posted"?L("مرحّل","Posted"):L("مسودة","Draft")}</span></td><td><div className="hr-actions"><button className="btn-ghost" onClick={()=>setOpened(r.month)}>{L("فتح / إجراءات","Open / Actions")}</button>{r.status==="draft"&&<button className="btn-ghost" disabled={busy} onClick={()=>remove(r)}>{L("حذف المسودة","Delete draft")}</button>}</div></td></tr>)}
    {!filtered.length&&<tr><td colSpan={4}>{loading?L("جارٍ التحميل…","Loading…"):L("لا توجد مسيرات مطابقة","No matching payroll runs")}</td></tr>}
    </tbody></table></div>
    {creating&&<HRDialog title={L("مسير رواتب جديد","New payroll")} onClose={()=>setCreating(false)}><label>{L("شهر الرواتب","Payroll month")}<input type="month" value={newMonth} onChange={e=>setNewMonth(e.target.value)}/></label><button className="btn-primary" disabled={!newMonth} onClick={()=>{setCreating(false);setOpened(newMonth);}}>{L("متابعة","Continue")}</button></HRDialog>}
    {opened&&<HRDialog title={L("مسير رواتب — ","Payroll — ")+opened} onClose={()=>{setOpened(null);reload();}}>{error && <p role="alert" className="balance-bad">{error}</p>}<PayrollRunEditor key={companyId+opened} companyId={companyId} companies={companies} initialMonth={opened} onChanged={reload} onDelete={remove}/></HRDialog>}
  </div>;
}
