import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/http";
import LanguageSwitcher from "../../wired/shared/LanguageSwitcher";

export default function PosLoginScreen() {
  const { t } = useTranslation();
  const { login, completeLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // هذه الهوية (بريد وكلمة مرور) منتمية لأكثر من شركة — نفس منطق LoginPage.jsx بالضبط: الخادم أعاد
  // قائمة الشركات ورمز اختيار مؤقت (identityToken) بدل جلسة كاملة؛ نعرض قائمة الاختيار هنا وننتظر
  // اختيار الكاشير قبل استدعاء completeLogin الذي يُصدِر رمز دخول حقيقي جديد فعلياً من الخادم.
  // لو كان للبريد شركة واحدة فقط، الخادم لا يعيد chooseAccount إطلاقاً (auth.service.ts) فيدخل
  // المستخدم مباشرة بلا أي شاشة إضافية — لا حاجة لأي تمييز خاص هنا لتلك الحالة.
  const [chooseAccount, setChooseAccount] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await login(email, password);
      if (result?.chooseAccount) {
        setChooseAccount(result);
      } else if (!result?.accessToken) {
        // احتياط: أي استجابة ناجحة (بلا استثناء) لا تحمل جلسة كاملة ولا طلب اختيار شركة يجب ألا
        // تترك الشاشة صامتة بلا أي تفسير للمستخدم.
        setError(t("pos.login.errGeneric"));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pos.login.errGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const chooseTenant = async (userId) => {
    setSubmitting(true);
    setError("");
    try {
      await completeLogin(chooseAccount.identityToken, userId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.login.chooseAccountErr"));
    } finally {
      setSubmitting(false);
    }
  };

  if (chooseAccount) {
    return (
      <div className="pos-login-root">
        <LanguageSwitcher className="pos-login-lang-switcher" />
        <div className="pos-login-card">
          <div className="pos-login-brand">{t("pos.login.brand")}</div>
          <h2 className="pos-login-choose-title">{t("auth.login.chooseAccountTitle")}</h2>
          <p className="pos-login-choose-sub">{t("auth.login.chooseAccountSub")}</p>
          {error && <p className="m-error">{error}</p>}
          <div className="pos-login-choose-list">
            {chooseAccount.accounts.map((acc) => (
              <button
                key={acc.userId}
                className="pos-big-btn"
                onClick={() => chooseTenant(acc.userId)}
                disabled={submitting}
              >
                {acc.tenantName}
              </button>
            ))}
          </div>
          <button className="m-btn secondary" onClick={() => setChooseAccount(null)} disabled={submitting}>
            {t("auth.login.chooseAccountBack")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-login-root">
      <LanguageSwitcher className="pos-login-lang-switcher" />
      <form className="pos-login-card" onSubmit={submit}>
        <div className="pos-login-brand">{t("pos.login.brand")}</div>
        <label className="m-field">
          {t("auth.login.email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="m-field">
          {t("auth.login.password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="m-error">{error}</p>}
        <button className="pos-big-btn" type="submit" disabled={submitting}>{submitting ? t("auth.login.submitting") : t("auth.login.submit")}</button>
      </form>
    </div>
  );
}
