import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";
import * as authApi from "../api/auth";

const ROLE_KEYS = {
  super_admin: "superAdmin",
  admin: "admin",
  finance_manager: "financeManager",
  accountant: "accountant",
  hr_manager: "hrManager",
  viewer: "viewer",
};

export default function AcceptInvitePage({ token, onGoLogin }) {
  const { t } = useTranslation();
  const { acceptInvite } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // معلومات الدعوة (الاسم/الشركة/الدور/هل هذه الهوية بحاجة لكلمة مرور جديدة أم لا) — تُجلَب مرة
  // واحدة عند فتح الصفحة قبل أي إرسال، لتقرير أي نموذج يُعرض: كلمة مرور جديدة (هوية جديدة تماماً)،
  // أم مجرد زر تأكيد انضمام (هوية موجودة بالفعل بكلمة مرور من عضوية أخرى — راجع تصميم فصل
  // Identity عن User في auth.service.ts).
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    authApi
      .getInviteInfo(token)
      .then((result) => { if (!cancelled) setInfo(result); })
      .catch((err) => { if (!cancelled) setInfoError(err instanceof ApiError ? err.message : t("auth.acceptInvite.invalidToken")); })
      .finally(() => { if (!cancelled) setLoadingInfo(false); });
    return () => { cancelled = true; };
  }, [token, t]);

  const submitWithPassword = async () => {
    if (password.length < 8) { setError(t("auth.register.errPasswordLength")); return; }
    if (password !== confirmPassword) { setError(t("auth.register.errPasswordMismatch")); return; }
    setSubmitting(true);
    setError("");
    try {
      await acceptInvite(token, password);
      // نجاح acceptInvite يُسجّل الدخول تلقائياً (applySession) — App.jsx سيعرض واجهة التطبيق
      // الرئيسية فور تحديث حالة isAuthenticated، فلا حاجة لأي تنقّل يدوي هنا.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.acceptInvite.errGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitJoinExisting = async () => {
    setSubmitting(true);
    setError("");
    try {
      await acceptInvite(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.acceptInvite.errGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabel = info ? t(`settings.users.roles.${ROLE_KEYS[info.role] || info.role}`) : "";

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="landing-brand auth-brand">
          <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <span>{t("common.brandName")}</span>
        </div>
        <h2 className="auth-title">{t("auth.acceptInvite.title")}</h2>

        {!token || infoError ? (
          <>
            <p className="balance-bad">{infoError || t("auth.acceptInvite.invalidToken")}</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
            </div>
          </>
        ) : loadingInfo ? (
          <p className="note auth-note">{t("auth.acceptInvite.loading")}</p>
        ) : info.requiresPassword ? (
          <>
            <p className="note auth-note">{t("auth.acceptInvite.note")}</p>
            <div className="auth-form">
              <label>{t("auth.login.password")}
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label>{t("auth.resetPassword.confirmPasswordLabel")}
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitWithPassword()}
                />
              </label>
              {error && <p className="balance-bad">{error}</p>}
              <button className="btn-primary auth-submit" onClick={submitWithPassword} disabled={submitting}>
                {submitting ? t("auth.acceptInvite.activating") : t("auth.acceptInvite.submitBtn")}
              </button>
            </div>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
            </div>
          </>
        ) : (
          <>
            <p className="note auth-note">
              {t("auth.acceptInvite.joinNote", { email: info.email, tenantName: info.tenantName, role: roleLabel })}
            </p>
            {error && <p className="balance-bad">{error}</p>}
            <div className="auth-form">
              <button className="btn-primary auth-submit" onClick={submitJoinExisting} disabled={submitting}>
                {submitting ? t("auth.acceptInvite.joining") : t("auth.acceptInvite.joinBtn")}
              </button>
            </div>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
