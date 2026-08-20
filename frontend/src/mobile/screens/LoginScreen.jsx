import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEmployeePortalAuth } from "../context/EmployeePortalAuthContext";
import LanguageSwitcher from "../../wired/shared/LanguageSwitcher";

export default function LoginScreen() {
  const { t } = useTranslation();
  const { login, rememberedTenantId } = useEmployeePortalAuth();
  const [tenantId, setTenantId] = useState(rememberedTenantId || "");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(tenantId.trim(), phone.trim(), pin.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m-app">
      <div className="m-header">
        <LanguageSwitcher className="m-login-lang-switcher" />
        <div className="m-header-title">{t("common.brandName")}</div>
        <div className="m-header-sub">{t("mobile.portalSubtitle")}</div>
      </div>
      <div className="m-main">
        <form className="m-card" onSubmit={submit}>
          <p style={{ marginTop: 0, fontSize: 13.5, color: "#6b7280" }}>
            {t("mobile.login.intro")}
          </p>
          <div className="m-field">
            <label>{t("mobile.login.tenantIdLabel")}</label>
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder={t("mobile.login.tenantIdPlaceholder")} required />
          </div>
          <div className="m-field">
            <label>{t("mobile.login.phoneLabel")}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
          </div>
          <div className="m-field">
            <label>{t("mobile.login.pinLabel")}</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" maxLength={6} required />
          </div>
          {error && <p className="m-error">{error}</p>}
          <button className="m-btn" disabled={loading} type="submit">{loading ? t("auth.login.submitting") : t("auth.login.submit")}</button>
        </form>
      </div>
    </div>
  );
}
