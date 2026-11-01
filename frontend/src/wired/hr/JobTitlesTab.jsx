import HRDialog from "./HRDialog";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listJobTitles, createJobTitle, renameJobTitle, deleteJobTitle } from "../../api/jobTitles";
import { useAuth } from "../../context/AuthContext";
import { routes } from "../../routes";
import { useToast, ToastHost } from "../shared/Toast";
import "../../styles/job-titles.css";

/**
 * شؤون الموظفين ← الوظائف: المسمّيات الوظيفية للمستأجر، محفوظة في الخادم (بعد أن كانت قائمة في ذاكرة المتصفح
 * داخل الإعدادات). كل وظيفة يُبنى منها منصب واحد في الإعدادات ← المناصب يحمل صلاحياتها، فالوظيفة التي لها منصب
 * لا تُحذَف هنا، وإعادة تسميتها تعيد تسمية منصبها (الخادم يفعل ذلك في jobTitles.service.ts).
 */
export default function JobTitlesTab() {
  const { t } = useTranslation();
  const { user: me, tenant } = useAuth();
  const isOwner = me?.role === "super_admin" || (!!me?.id && me.id === tenant?.ownerId);
  const { toast, notify, dismiss } = useToast();
  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen,setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const reload = () => {
    setLoading(true);
    listJobTitles().then(setTitles).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await createJobTitle(name.trim());
      setName(""); setFormOpen(false);
      reload();
      notify(t("settings.jobTitles.notifyAdded"), "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveRename = async (title) => {
    if (!editName.trim()) return;
    try {
      await renameJobTitle(title.id, editName.trim());
      setEditingId(null);
      reload();
      notify(t("settings.jobTitles.notifyRenamed"), "success");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const remove = async (title) => {
    if (!window.confirm(t("settings.jobTitles.confirmDelete", { name: title.name }))) return;
    try {
      await deleteJobTitle(title.id);
      reload();
      notify(t("settings.jobTitles.notifyDeleted"), "success");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  return (
    <div className="job-titles">
      <div className="hr-list-toolbar"><button className="btn-primary" onClick={()=>setFormOpen(true)}>{t("settings.jobTitles.newTitleLabel")}</button></div>
      {formOpen && <HRDialog title={t("settings.jobTitles.newTitleLabel")} onClose={()=>setFormOpen(false)}><div className="panel job-titles-add">
        <label className="memo-field">{t("settings.jobTitles.newTitleLabel")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={t("settings.jobTitles.placeholder")} />
        </label>
        <button className="btn-primary" onClick={add} disabled={saving || !name.trim()}>{t("common.add")}</button>
        <p className="note">{t("settings.jobTitles.note")}</p>
      </div></HRDialog>}

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel">
          {titles.length === 0 ? <p className="empty">{t("settings.jobTitles.empty")}</p> : (
            <table className="ledger-table">
              <thead><tr>
                <th>{t("settings.jobTitles.table.name")}</th>
                <th>{t("settings.jobTitles.table.permissions")}</th>
                <th>{t("settings.jobTitles.table.actions")}</th>
              </tr></thead>
              <tbody>
                {titles.map((title) => (
                  <tr key={title.id}>
                    <td>
                      {title.name}
                    </td>
                    <td>
                      <span className={`status-badge${title.positionId ? " job-has-position" : ""}`}>
                        {title.positionId ? t("settings.jobTitles.hasPosition") : t("settings.jobTitles.noPosition")}
                      </span>
                      {isOwner && <Link className="job-permissions-link" to={routes.settings("positions")}>{t("settings.jobTitles.managePermissions")}</Link>}
                    </td>
                    <td className="row-actions">
                      <button className="btn-ghost" aria-label={t("settings.jobTitles.editBtn")+" "+title.name} onClick={()=>{setEditingId(title.id);setEditName(title.name);}}>{t("settings.jobTitles.editBtn")}</button>
                      <button className="btn-ghost" aria-label={t("settings.jobTitles.deleteBtn")+" "+title.name} onClick={()=>remove(title)} disabled={!!title.positionId}>{t("settings.jobTitles.deleteBtn")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {editingId && <HRDialog title={t("settings.jobTitles.editBtn")} onClose={()=>setEditingId(null)}>
        <label>{t("settings.jobTitles.table.name")}<input value={editName} onChange={e=>setEditName(e.target.value)}/></label>
        <button className="btn-primary" disabled={!editName.trim()} onClick={()=>saveRename({id:editingId})}>{t("settings.jobTitles.saveBtn")}</button>
      </HRDialog>}
      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
