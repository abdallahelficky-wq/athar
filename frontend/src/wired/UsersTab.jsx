import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listUsers, inviteUser, updateUser, resendInvite, setUserActive, deleteUser } from "../api/auth";
import { listPositions } from "../api/positions";
import { useAuth } from "../context/AuthContext";
import { useToast, ToastHost } from "./shared/Toast";
import "../styles/users-tab.css";

const emptyForm = () => ({ name: "", email: "", role: "accountant", companyScope: "all", positionId: "" });

/**
 * إدارة مستخدمي هذا المستأجر. الإضافة والتعديل في نافذة منبثقة واحدة: الدعوة ترسل إيميل تفعيل حقيقي
 * (المستخدم "معلّق" حتى يفعّل حسابه بنفسه)، والتعديل يغيّر الاسم والدور والنطاق — والمنصب لمالك الشركة
 * وحده (الخادم يفرض ذلك، والواجهة لا تعرض القائمة لغيره). الحذف لموظف ترك العمل: يخرجه من القوائم
 * ويمنع دخوله، ويبقى اسمه على كل ما أدخله (راجع deleteUser في auth.service.ts).
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
  const iAmOwner = me?.role === "super_admin" || (!!me?.id && me.id === tenant?.ownerId);

  const [users, setUsers] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", user }
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState(null);
  const [actingId, setActingId] = useState(null);

  const reload = () => {
    setLoading(true);
    listUsers().then(setUsers).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, []);
  useEffect(() => {
    if (iAmOwner) listPositions().then(setPositions).catch(() => setPositions([]));
  }, [iAmOwner]);

  const editing = modal?.mode === "edit" ? modal.user : null;
  const accessLocked = editing && (editing.id === me?.id || editing.id === tenant?.ownerId);

  const openAdd = () => { setForm(emptyForm()); setModal({ mode: "add" }); };
  const openEdit = (u) => {
    setForm({ name: u.name, email: u.email, role: u.role, companyScope: u.companyScope || "all", positionId: u.positionId || "" });
    setModal({ mode: "edit", user: u });
  };
  const closeModal = () => { if (!saving) setModal(null); };

  const submit = async () => {
    if (!form.name.trim() || (!editing && !form.email.trim())) return;
    setSaving(true);
    try {
      const positionId = form.positionId || null;
      if (editing) {
        const payload = { name: form.name.trim() };
        if (!accessLocked) Object.assign(payload, { role: form.role, companyScope: form.companyScope });
        if (iAmOwner && positionId !== (editing.positionId || null)) payload.positionId = positionId;
        await updateUser(editing.id, payload);
        notify(t("settings.users.notifyUpdated", { name: payload.name }), "success");
      } else {
        const payload = { name: form.name.trim(), email: form.email.trim(), role: form.role, companyScope: form.companyScope };
        if (iAmOwner && positionId) payload.positionId = positionId;
        const result = await inviteUser(payload);
        notify(result.emailSent ? t("settings.users.notifyInviteSent", { email: payload.email }) : t("settings.users.notifyInviteFailedCreated"), result.emailSent ? "success" : "error");
      }
      setModal(null);
      reload();
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
      const result = await deleteUser(u.id);
      reload();
      notify(t(result?.archived === false ? "settings.users.notifyDeletedUnused" : "settings.users.notifyDeleted", { name: u.name }), "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="users-tab">
      <div className="users-toolbar">
        <p className="note">{t("settings.users.note")}</p>
        <button className="btn-primary" onClick={openAdd}>{t("settings.users.addUserBtn")}</button>
      </div>

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel users-table-wrap">
          <table className="ledger-table">
            <thead><tr>
              <th>{t("settings.users.table.name")}</th><th>{t("settings.users.table.email")}</th><th>{t("settings.users.table.role")}</th>
              <th>{t("settings.users.table.position")}</th><th>{t("settings.users.table.inviteStatus")}</th><th>{t("settings.users.table.status")}</th>
              <th>{t("settings.users.table.actions")}</th>
            </tr></thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === me?.id;
                const isOwner = u.id === tenant?.ownerId;
                const busy = actingId === u.id;
                const locked = isSelf || isOwner || busy;
                return (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>{u.positionName || "—"}</td>
                  <td><span className="status-badge">{u.inviteStatus === "pending" ? t("settings.users.statusPending") : t("settings.users.statusActive")}</span></td>
                  <td><span className="status-badge">{u.active ? t("settings.users.activeLabel") : t("settings.users.disabledLabel")}</span></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => openEdit(u)} disabled={busy} aria-label={`${t("settings.users.editBtn")} ${u.name}`}>
                      {t("settings.users.editBtn")}
                    </button>
                    {u.inviteStatus === "pending" && (
                      <button className="btn-ghost" onClick={() => doResend(u)} disabled={resendingId === u.id}>
                        {resendingId === u.id ? t("settings.users.sending") : t("settings.users.resend")}
                      </button>
                    )}
                    <button className="btn-ghost" onClick={() => doToggleActive(u)} disabled={locked}>
                      {u.active ? t("settings.users.disableBtn") : t("settings.users.enableBtn")}
                    </button>
                    <button className="btn-ghost users-delete-btn" onClick={() => doDelete(u)} disabled={locked} aria-label={`${t("settings.users.deleteBtn")} ${u.name}`}>
                      {t("settings.users.deleteBtn")}
                    </button>
                  </td>
                </tr>
                );
              })}
              {users.length === 0 && <tr><td className="empty" colSpan={7}>{t("settings.users.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="unpost-confirm-box users-modal" role="dialog" aria-modal="true" aria-labelledby="users-modal-title">
            <div className="modal-title-row">
              <h3 id="users-modal-title">{editing ? t("settings.users.editUserTitle") : t("settings.users.addUserTitle")}</h3>
              <button type="button" className="modal-close-btn" onClick={closeModal} disabled={saving} aria-label={t("common.close")}>×</button>
            </div>
            <div className="users-modal-fields">
              <label>{t("settings.users.nameLabel")}
                <input type="text" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>{t("settings.users.emailLabel")}
                <input type="email" value={form.email} disabled={!!editing} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {editing && <span className="note">{t("settings.users.emailLocked")}</span>}
              </label>
              <label>{t("settings.users.roleLabel")}
                <select value={form.role} disabled={accessLocked} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {!ROLES.some((r) => r.id === form.role) && <option value={form.role}>{ROLE_LABELS[form.role] || form.role}</option>}
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
              <label>{t("settings.users.scopeLabel")}
                <select value={form.companyScope} disabled={accessLocked} onChange={(e) => setForm({ ...form, companyScope: e.target.value })}>
                  <option value="all">{t("settings.users.allCompanies")}</option>
                  {(realCompanies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              {accessLocked && <p className="note">{editing.id === tenant?.ownerId ? t("settings.users.ownerAccessLocked") : t("settings.users.selfAccessLocked")}</p>}
              <label>{t("settings.users.positionLabel")}
                <select value={form.positionId} disabled={!iAmOwner} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
                  <option value="">{t("settings.users.noPosition")}</option>
                  {!iAmOwner && editing?.positionId && <option value={editing.positionId}>{editing.positionName}</option>}
                  {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {!iAmOwner && <span className="note">{t("settings.users.positionOwnerOnly")}</span>}
              </label>
            </div>
            <div className="form-btn-group users-modal-actions">
              <button className="btn-ghost" onClick={closeModal} disabled={saving}>{t("common.cancel")}</button>
              <button className="btn-primary" onClick={submit} disabled={saving || !form.name.trim() || (!editing && !form.email.trim())}>
                {saving ? t("settings.users.sending") : editing ? t("settings.users.saveBtn") : t("settings.users.inviteBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
