import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployeeAdvances, setAdvanceInstallment, getAdvancesReclassPreview } from "../../api/employeeAdvances";
import { fmt } from "../../legacy/constants";

/**
 * شاشة سلف الموظفين: كل سلف الشركة بأرصدتها، والسلف النشطة بلا قسط شهري معلَّمة «تحتاج قسطاً» (لا يخصمها كشف الرواتب حتى
 * يُحدَّد قسطها هنا)، ومعاينة إعادة تصنيف الأرصدة القائمة من الحساب المشترك إلى حسابات الموظفين الفرعية — معاينة فقط، لا ترحيل.
 */
export default function EmployeeAdvancesTab({ companyId }) {
  const { t } = useTranslation();
  const [advances, setAdvances] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    if (!companyId) return;
    listEmployeeAdvances(companyId).then(setAdvances).catch((e) => setError(e.message));
  };
  useEffect(() => { setPreview(null); reload(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveInstallment = async (advance) => {
    try {
      await setAdvanceInstallment(advance.id, Number(drafts[advance.id]));
      setDrafts({ ...drafts, [advance.id]: undefined }); setError("");
      reload();
    } catch (err) { setError(err.message); }
  };

  const loadPreview = async () => {
    try { setPreview(await getAdvancesReclassPreview(companyId)); setError(""); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      {error && <p className="balance-bad" role="alert">{error}</p>}
      <div className="panel" data-testid="employee-advances-list">
        <h3 className="sub-head">{t("hr.payroll.advListTitle")}</h3>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>{t("hr.payroll.advEmployee")}</th><th>{t("hr.payroll.advAmount")}</th><th>{t("hr.payroll.advRemaining")}</th><th>{t("hr.payroll.advInstallment")}</th><th>{t("hr.payroll.advAccount")}</th><th>{t("hr.payroll.advStart")}</th><th>{t("hr.payroll.advStatus")}</th><th></th></tr></thead>
            <tbody>
              {advances.map((a) => (
                <tr key={a.id}>
                  <td>{a.employee?.name}</td>
                  <td className="num">{fmt(a.amount)}</td>
                  <td className="num">{fmt(a.remainingBalance)}</td>
                  <td className="num">{a.monthlyInstallment == null ? "—" : fmt(a.monthlyInstallment)}</td>
                  <td>{a.account ? `${a.account.code} — ${a.account.name}` : ""}</td>
                  <td>{String(a.startDate).slice(0, 10)}</td>
                  <td>
                    {a.needsInstallment
                      ? <span className="status-badge balance-bad">{t("hr.payroll.advNeedsInstallment")}</span>
                      : <span className="status-badge">{a.status === "active" ? t("hr.payroll.advStatusActive") : t("hr.payroll.advStatusSettled")}</span>}
                  </td>
                  <td className="row-actions">
                    {a.status === "active" && (
                      <>
                        <input type="number" min="0" step="0.01" className="amount-input" placeholder={t("hr.payroll.advSetInstallment")}
                          value={drafts[a.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [a.id]: e.target.value })} />
                        <button className="btn-ghost" disabled={!drafts[a.id]} onClick={() => saveInstallment(a)}>{t("hr.payroll.advSaveInstallment")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {advances.length === 0 && <tr><td className="empty" colSpan={8}>{t("hr.payroll.advEmpty")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" data-testid="advances-reclass-preview">
        <div className="items-form-heading"><strong>{t("hr.payroll.advReclassTitle")}</strong><button className="btn-ghost" onClick={loadPreview}>{t("hr.payroll.advReclassBtn")}</button></div>
        <p className="note">{t("hr.payroll.advReclassNote")}</p>
        {preview && (
          <>
            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead><tr><th>{t("hr.payroll.advAccount")}</th><th>{t("hr.payroll.advEmployee")}</th><th>{t("hr.payroll.advDebit")}</th><th>{t("hr.payroll.advCredit")}</th></tr></thead>
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.accountCode ? `${l.accountCode} — ` : ""}{l.accountName}{l.willBeCreated && <small> ({t("hr.payroll.advWillBeCreated")})</small>}</td>
                      <td>{advances.find((a) => a.employeeId === l.employeeId)?.employee?.name ?? ""}</td>
                      <td className="num">{l.debit ? fmt(l.debit) : ""}</td>
                      <td className="num">{l.credit ? fmt(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}></td><td className="num strong">{fmt(preview.totals.debit)}</td><td className="num strong">{fmt(preview.totals.credit)}</td></tr></tfoot>
              </table>
            </div>
            <h3 className="sub-head">{t("hr.payroll.advGlCheck")}</h3>
            {preview.accounts.map((acc) => (
              <div key={acc.accountId} className="lines-table-wrap">
                <p><strong>{acc.code} — {acc.name}</strong>: {t("hr.payroll.advGlBalance")} {fmt(acc.glBalance)} · {t("hr.payroll.advAdvancesRemaining")} {fmt(acc.advancesRemaining)} · <span className={acc.difference ? "balance-bad" : ""}>{t("hr.payroll.advDifference")} {fmt(acc.difference)}</span> · {t("hr.payroll.advUntagged")} {fmt(acc.untaggedGlBalance)}</p>
                <table className="lines-table">
                  <thead><tr><th>{t("hr.payroll.advEmployee")}</th><th>{t("hr.payroll.advGlBalance")}</th><th>{t("hr.payroll.advAdvancesRemaining")}</th><th>{t("hr.payroll.advDifference")}</th></tr></thead>
                  <tbody>
                    {acc.employees.map((e) => (
                      <tr key={e.employeeId}>
                        <td>{e.name ?? advances.find((a) => a.employeeId === e.employeeId)?.employee?.name ?? e.employeeId}</td>
                        <td className="num">{fmt(e.glBalance)}</td>
                        <td className="num">{fmt(e.advancesRemaining)}</td>
                        <td className={`num ${e.difference ? "balance-bad" : ""}`}>{fmt(e.difference)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
