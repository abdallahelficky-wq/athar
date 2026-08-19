import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCompanyDocuments, createCompanyDocument, deleteCompanyDocument } from "../api/companyDocuments";

// مطابق لقائمة COMPANY_DOC_TYPES في النموذج المرجعي (reference/AtharAlMuhasabi.jsx)
const DOC_TYPES = ["السجل التجاري", "رخصة الدفاع المدني", "الرخصة البلدية", "شهادة الزكاة والضريبة", "رخصة وزارة الطاقة", "عقد أمن وسلامة", "أخرى"];

/** مستندات إدارية عامة للشركة (تراخيص بلدية، دفاع مدني، عقود أمن وسلامة...) بتاريخ انتهاء —
 * تُغذّي تنبيهات "مستند إداري قارب على الانتهاء" في الداشبورد المالية */
export default function CompanyDocumentsPanel({ companyId }) {
  const { t } = useTranslation();
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
    if (!window.confirm(t("settings.companyDocuments.confirmDelete"))) return;
    await deleteCompanyDocument(d.id);
    reload();
  };

  return (
    <div>
      <h4 className="sub-head">{t("settings.companyDocuments.title")}</h4>
      <div className="form-grid">
        <label>{t("settings.companyDocuments.docTypeLabel")}
          <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
            {DOC_TYPES.map((t2) => <option key={t2}>{t2}</option>)}
          </select>
        </label>
        <label>{t("settings.companyDocuments.numberLabel")}<input type="text" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>
        <label>{t("settings.companyDocuments.expiryLabel")}<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></label>
      </div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
        <button className="btn-ghost" onClick={add}>{t("settings.companyDocuments.addBtn")}</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <table className="ledger-table">
          <thead><tr><th>{t("settings.companyDocuments.table.type")}</th><th>{t("settings.companyDocuments.table.number")}</th><th>{t("settings.companyDocuments.table.expiry")}</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.docType}</td>
                <td>{d.number || "—"}</td>
                <td>{d.expiryDate ? d.expiryDate.slice(0, 10) : "—"}</td>
                <td className="row-actions"><button className="btn-ghost" onClick={() => remove(d)}>{t("common.delete")}</button></td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td className="empty" colSpan={4}>{t("settings.companyDocuments.empty")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
