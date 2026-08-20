import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/http";
import LanguageSwitcher from "../../wired/shared/LanguageSwitcher";

export default function PosLoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pos.login.errGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

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
