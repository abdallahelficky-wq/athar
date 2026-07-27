import React, { useEffect, useState } from "react";
import { listCompanyDocuments, createCompanyDocument, deleteCompanyDocument } from "../api/companyDocuments";

// مطابق لقائمة COMPANY_DOC_TYPES في النموذج المرجعي (reference/AtharAlMuhasabi.jsx)
const DOC_TYPES = ["السجل التجاري", "رخصة الدفاع المدني", "الرخصة البلدية", "شهادة الزكاة والضريبة", "رخصة وزارة الطاقة", "عقد أمن وسلامة", "أخرى"];

/** مستندات إدارية عامة للشركة (تراخيص بلدية، دفاع مدني، عقود أمن وسلامة...) بتاريخ انتهاء —
 * تُغذّي تنبيهات "مستند إداري قارب على الانتهاء" في الداشبورد المالية */
export default function CompanyDocumentsPanel({ companyId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ docType: DOC_TYPES[0], number: "", expiryDate: "" });
  const [error, setError] = useState("");

  const reload = () => {
    setLoading(true);
    listCompanyDocuments(companyId).then(setDocs).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const add = async () => {
    setError("");
    try {
      await createCompanyDocument({
        companyId, docType: form.docType,
        number: form.number.trim() || undefined,
        expiryDate: form.expiryDate || undefined,
      });
      setForm({ docType: DOC_TYPES[0], number: "", expiryDate: "" });
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (d) => {
    if (!window.confirm("حذف هذا المستند؟")) return;
    await deleteCompanyDocument(d.id);
    reload();
  };

  return (
    <div>
      <h4 className="sub-head">المستندات الإدارية (تراخيص، سجلات، عقود أمن وسلامة...)</h4>
      <div className="form-grid">
        <label>نوع المستند
          <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>الرقم (اختياري)<input type="text" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>
        <label>تاريخ الانتهاء<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></label>
      </div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
        <button className="btn-ghost" onClick={add}>+ إضافة مستند</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <table className="ledger-table">
          <thead><tr><th>النوع</th><th>الرقم</th><th>تاريخ الانتهاء</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.docType}</td>
                <td>{d.number || "—"}</td>
                <td>{d.expiryDate ? d.expiryDate.slice(0, 10) : "—"}</td>
                <td className="row-actions"><button className="btn-ghost" onClick={() => remove(d)}>حذف</button></td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td className="empty" colSpan={4}>لا توجد مستندات إدارية مسجّلة بعد.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
