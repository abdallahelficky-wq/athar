import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";
import { getEmployeePortalAccess, setEmployeePortalAccess } from "../../api/employees";

/**
 * دخول الموظف لبوابة الجوال (الحضور، الإجازات، ورديات المحطة) — كان يُضبط عبر API فقط بلا أي شاشة.
 * رقم جوال + PIN من 6 أرقام + تفعيل/إيقاف. لا يُعرَض الـ PIN المخزَّن أبداً (الخادم لا يعيد إلا "مضبوط
 * أم لا")؛ بعد الحفظ تظهر بيانات الدخول الثلاث التي يُسلِّمها المسؤول للموظف: رمز المنشأة، الجوال، الـ PIN.
 */
export default function EmployeePortalAccessPanel({ employeeId, defaultPhone, employeeStatus }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [phone, setPhone] = useState(defaultPhone || "");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setIssued(null); setPin(""); setError("");
    getEmployeePortalAccess(employeeId)
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        setPhone(s.phone || defaultPhone || "");
        setActive(s.pinSet ? s.portalActive : true);
      })
      // 403: دور بلا صلاحية إدارة الموظفين — القسم لا يخصّه فلا يُعرَض إطلاقاً
      .catch((e) => { if (!cancelled) { if (e?.status === 403) setHidden(true); else setError(e.message); } });
    return () => { cancelled = true; };
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) return null;

  const pinRequired = !status?.pinSet;
  const save = async () => {
    setError("");
    if (phone.trim().length < 5) { setError(t("hr.directory.portal.errPhone")); return; }
    if ((pinRequired || pin) && !/^\d{6}$/.test(pin)) { setError(t("hr.directory.portal.errPin")); return; }
    setSaving(true);
    try {
      const next = await setEmployeePortalAccess(employeeId, { phone: phone.trim(), portalActive: active, ...(pin ? { pin } : {}) });
      setStatus(next);
      setIssued(next.portalActive ? { phone: next.phone, pin: pin || null } : null);
      setPin("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const stateLabel = !status
    ? "…"
    : !status.pinSet
      ? t("hr.directory.portal.stateNotSet")
      : status.lockedUntil
        ? t("hr.directory.portal.stateLocked", { until: new Date(status.lockedUntil).toLocaleString() })
        : status.portalActive
          ? t("hr.directory.portal.stateActive")
          : t("hr.directory.portal.stateDisabled");

  return (
    <section className="portal-access-panel" aria-labelledby={`portal-access-${employeeId}`}>
      <h3 className="sub-head" id={`portal-access-${employeeId}`}>{t("hr.directory.portal.title")}</h3>
      <p className="note">{t("hr.directory.portal.note")}</p>
      <div className="portal-access-state">
        <span className="status-badge">{stateLabel}</span>
        {employeeStatus && employeeStatus !== "active" && <span className="note">{t("hr.directory.portal.inactiveEmployee")}</span>}
      </div>

      <div className="form-grid">
        <label>{t("hr.directory.portal.phone")}
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05XXXXXXXX" />
        </label>
        <label>{pinRequired ? t("hr.directory.portal.pinNew") : t("hr.directory.portal.pinChange")}
          <input
            type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
          />
        </label>
        <label className="portal-access-toggle">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("hr.directory.portal.enabled")}
        </label>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      <button className="btn-ghost" onClick={save} disabled={saving || !status}>
        {saving ? t("hr.directory.portal.saving") : t("hr.directory.portal.save")}
      </button>

      {issued && (
        <div className="portal-access-issued" role="status">
          <div className="portal-access-issued-title">{t("hr.directory.portal.issuedTitle")}</div>
          <dl>
            <dt>{t("hr.directory.portal.companyCode")}</dt><dd dir="ltr">{tenant?.code ?? "—"}</dd>
            <dt>{t("hr.directory.portal.phone")}</dt><dd dir="ltr">{issued.phone}</dd>
            <dt>{t("hr.directory.portal.pin")}</dt><dd dir="ltr">{issued.pin ?? t("hr.directory.portal.pinUnchanged")}</dd>
          </dl>
          <p className="note">{t("hr.directory.portal.issuedNote")}</p>
        </div>
      )}
    </section>
  );
}
