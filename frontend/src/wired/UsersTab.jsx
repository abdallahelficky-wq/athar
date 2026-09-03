import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listUsers, inviteUser, resendInvite, setUserActive, deleteUser } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { useToast, ToastHost } from "./shared/Toast";

const emptyForm = () => ({ name: "", email: "", role: "accountant", companyScope: "all" });

/**
 * إدارة مستخدمي هذا المستأجر — دعوة مستخدم جديد ترسل إيميل تفعيل حقيقي (بدل باسورد مؤقت
 * يدوي)، والمستخدم يظل "معلّق" حتى يفعّل حسابه بنفسه عبر الرابط؛ "إعادة إرسال الدعوة" تُنشئ
 * رابطاً جديداً وترسله من جديد لو انتهت صلاحية الرابط الأول أو ضاع.
 */
export default function UsersTab({ realCompanies }) {
  const { t } = useTranslation();
  const { user: me, tenant } = useAuth();
  const ROLES = [
    { id: "admin", label: t("settings.users.roles.admin") },
    { id: "finance_manager", label: t("settings.users.roles.financeManager") },
    { id: "accountant", label: t("settings.users.roles.accountant") },
    { id: "hr_manager", label: t("settings.users.roles.hrManager") },
    { id: "viewer", label: t("settings.users.roles.viewer") },
  ];
  const ROLE_LABELS = { super_admin: t("settings.users.roles.superAdmin"), ...Object.fromEntries(ROLES.map((r) => [r.id, r.label])) };

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState(null);
  const [actingId, setActingId] = useState(null);

  const reload = () => {
    setLoading(true);
    listUsers().then(setUsers).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const invite = async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    try {
      const result = await inviteUser(form);
      setForm(emptyForm());
      reload();
      notify(result.emailSent ? t("settings.users.notifyInviteSent", { email: form.email }) : t("settings.users.notifyInviteFailedCreated"), result.emailSent ? "success" : "error");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const doResend = async (u) => {
    setResendingId(u.id);
    try {
      const result = await resendInvite(u.id);
      reload();
      notify(result.emailSent ? t("settings.users.notifyResendSent", { email: u.email }) : t("settings.users.notifyResendFailed"), result.emailSent ? "success" : "error");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setResendingId(null);
    }
  };

  const doToggleActive = async (u) => {
    const key = u.active ? "confirmDisable" : "confirmEnable";
    if (!window.confirm(t(`settings.users.${key}`, { name: u.name }))) return;
    setActingId(u.id);
    try {
      await setUserActive(u.id, !u.active);
      reload();
      notify(t(u.active ? "settings.users.notifyDisabled" : "settings.users.notifyEnabled", { name: u.name }), "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setActingId(null);
    }
  };

  const doDelete = async (u) => {
    if (!window.confirm(t("settings.users.confirmDelete", { name: u.name }))) return;
    setActingId(u.id);
    try {
      await deleteUser(u.id);
      reload();
      notify(t("settings.users.notifyDeleted", { name: u.name }), "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("settings.users.nameLabel")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("settings.users.emailLabel")}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>{t("settings.users.roleLabel")}<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <label>{t("settings.users.scopeLabel")}
            <select value={form.companyScope} onChange={(e) => setForm({ ...form, companyScope: e.target.value })}>
              <option value="all">{t("settings.users.allCompanies")}</option>
              {(realCompanies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-primary" onClick={invite} disabled={saving || !form.name.trim() || !form.email.trim()}>
          {saving ? t("settings.users.sending") : t("settings.users.inviteBtn")}
        </button>
        <p className="note">{t("settings.users.note")}</p>
      </div>

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("settings.users.table.name")}</th><th>{t("settings.users.table.email")}</th><th>{t("settings.users.table.role")}</th><th>{t("settings.users.table.inviteStatus")}</th><th>{t("settings.users.table.status")}</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === me?.id;
                const isOwner = u.id === tenant?.ownerId;
                const disableActions = isSelf || isOwner || actingId === u.id;
                return (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td><span className="status-badge">{u.inviteStatus === "pending" ? t("settings.users.statusPending") : t("settings.users.statusActive")}</span></td>
                  <td><span className="status-badge">{u.active ? t("settings.users.activeLabel") : t("settings.users.disabledLabel")}</span></td>
                  <td className="row-actions">
                    {u.inviteStatus === "pending" && (
                      <button className="btn-ghost" onClick={() => doResend(u)} disabled={resendingId === u.id}>
                        {resendingId === u.id ? t("settings.users.sending") : t("settings.users.resend")}
                      </button>
                    )}
                    <button className="btn-ghost" onClick={() => doToggleActive(u)} disabled={disableActions}>
                      {u.active ? t("settings.users.disableBtn") : t("settings.users.enableBtn")}
                    </button>
                    <button className="btn-ghost" onClick={() => doDelete(u)} disabled={disableActions}>
                      {t("settings.users.deleteBtn")}
                    </button>
                  </td>
                </tr>
                );
              })}
              {users.length === 0 && <tr><td className="empty" colSpan={6}>{t("settings.users.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
