import React, { useEffect, useState } from "react";
import { listLeaseContracts, createLeaseContract, deleteLeaseContract } from "../api/leaseContracts";
import { fmt } from "../legacy/constants";

const emptyForm = { title: "", counterparty: "", monthlyRent: "", startDate: "", endDate: "" };

/** عقود إيجار الشركة (مقرات/فروع/مستودعات) — تُغذّي تنبيه "عقد إيجار قارب على الانتهاء" */
export default function LeaseContractsPanel({ companyId }) {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  const reload = () => {
    setLoading(true);
    listLeaseContracts(companyId).then(setContracts).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const add = async () => {
    if (!form.title.trim() || !form.startDate || !form.endDate) { setError("اسم العقد وتاريخا البداية والنهاية مطلوبة"); return; }
    setError("");
    try {
      await createLeaseContract({
        companyId, title: form.title.trim(),
        counterparty: form.counterparty.trim() || undefined,
        monthlyRent: form.monthlyRent ? Number(form.monthlyRent) : undefined,
        startDate: form.startDate, endDate: form.endDate,
      });
      setForm(emptyForm);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`حذف عقد "${c.title}"؟`)) return;
    await deleteLeaseContract(c.id);
    reload();
  };

  return (
    <div>
      <h4 className="sub-head">عقود الإيجار</h4>
      <div className="form-grid">
        <label>اسم/عنوان العقد<input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثال: مقر جدة الرئيسي" /></label>
        <label>المؤجِّر (اختياري)<input type="text" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></label>
        <label>الإيجار الشهري (اختياري)<input type="number" value={form.monthlyRent} onChange={(e) => setForm({ ...form, monthlyRent: e.target.value })} /></label>
        <label>تاريخ البداية<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
        <label>تاريخ الانتهاء<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
      </div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
        <button className="btn-ghost" onClick={add}>+ إضافة عقد إيجار</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <table className="ledger-table">
          <thead><tr><th>العقد</th><th>المؤجِّر</th><th>الإيجار الشهري</th><th>البداية</th><th>النهاية</th><th></th></tr></thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{c.counterparty || "—"}</td>
                <td className="num">{c.monthlyRent ? fmt(c.monthlyRent) : "—"}</td>
                <td>{c.startDate.slice(0, 10)}</td>
                <td>{c.endDate.slice(0, 10)}</td>
                <td className="row-actions"><button className="btn-ghost" onClick={() => remove(c)}>حذف</button></td>
              </tr>
            ))}
            {contracts.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد عقود إيجار مسجّلة بعد.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
