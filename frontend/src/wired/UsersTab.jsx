import React, { useEffect, useState } from "react";
import { listUsers, inviteUser, resendInvite } from "../api/auth";
import { useToast, ToastHost } from "./shared/Toast";

const ROLES = [
  { id: "admin", label: "مدير النظام" },
  { id: "finance_manager", label: "مدير مالي" },
  { id: "accountant", label: "محاسب" },
  { id: "hr_manager", label: "مسؤول موارد بشرية" },
  { id: "viewer", label: "مشاهدة فقط" },
];
const ROLE_LABELS = { super_admin: "مدير عام", ...Object.fromEntries(ROLES.map((r) => [r.id, r.label])) };

const emptyForm = () => ({ name: "", email: "", role: ROLES[2].id, companyScope: "all" });

/**
 * إدارة مستخدمي هذا المستأجر — دعوة مستخدم جديد ترسل إيميل تفعيل حقيقي (بدل باسورد مؤقت
 * يدوي)، والمستخدم يظل "معلّق" حتى يفعّل حسابه بنفسه عبر الرابط؛ "إعادة إرسال الدعوة" تُنشئ
 * رابطاً جديداً وترسله من جديد لو انتهت صلاحية الرابط الأول أو ضاع.
 */
export default function UsersTab({ realCompanies }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState(null);

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
      notify(result.emailSent ? `تم إرسال دعوة إلى ${form.email}.` : "تم إنشاء المستخدم، لكن تعذّر إرسال إيميل الدعوة — استخدم زر (إعادة إرسال الدعوة) لاحقاً.", result.emailSent ? "success" : "error");
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
      notify(result.emailSent ? `تم إرسال دعوة جديدة إلى ${u.email}.` : "تعذّر إرسال إيميل الدعوة — حاول مرة أخرى لاحقاً.", result.emailSent ? "success" : "error");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الاسم<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>الصلاحية<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <label>نطاق الوصول (الشركة)
            <select value={form.companyScope} onChange={(e) => setForm({ ...form, companyScope: e.target.value })}>
              <option value="all">كل الشركات</option>
              {(realCompanies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-primary" onClick={invite} disabled={saving || !form.name.trim() || !form.email.trim()}>
          {saving ? "جارٍ الإرسال..." : "إرسال دعوة لمستخدم جديد"}
        </button>
        <p className="note">سيصل المدعوّ إيميل يحتوي رابطاً آمناً لتعيين كلمة مروره الخاصة وتفعيل حسابه بنفسه.</p>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الصلاحية</th><th>حالة الدعوة</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td><span className="status-badge">{u.inviteStatus === "pending" ? "بانتظار التفعيل" : "مفعَّل"}</span></td>
                  <td className="row-actions">
                    {u.inviteStatus === "pending" && (
                      <button className="btn-ghost" onClick={() => doResend(u)} disabled={resendingId === u.id}>
                        {resendingId === u.id ? "جارٍ الإرسال..." : "إعادة إرسال الدعوة"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td className="empty" colSpan={5}>لا يوجد مستخدمون بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
