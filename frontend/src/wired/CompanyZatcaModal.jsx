import React, { useEffect, useState } from "react";
import { getUnarchivedZatcaDocuments } from "../api/vatReconciliation";
import { useTranslation } from "react-i18next";
import {
  onboardCompanyZatca,
  getCompanyZatcaStatus,
  generateCompanyZatcaCsr,
  requestCompanyZatcaCompliance,
  requestCompanyZatcaProduction,
  setCompanyZatcaEnvironment,
  resetCompanyZatcaLinkage,
  getCompanyZatcaComplianceSteps,
  runCompanyZatcaComplianceStepTest,
} from "../api/companies";

/**
 * الخيارات المتقدمة لربط فاتورة (ZATCA) — كل خطوة يدوياً كما كانت قبل الربط بخطوة واحدة؛ تبقى للدعم
 * الفني والحالات التي يوقِف فيها المنسِّق الآلي العمل عمداً (مراجعة شهادة الإنتاج، إعادة الضبط).
 * الأصل: توليد CSR، طلب شهادة اختبار (Compliance) عبر OTP يحصل
 * عليه مسؤول الشركة من بوابة فاتورة الحقيقية، ثم استبدالها بشهادة إنتاج فعلية، مع تبديل البيئة
 * وعرض حالة الربط الحالية بوضوح. كل خطوة اختيارية تماماً (opt-in) لكل شركة على حدة — لا تفعيل
 * تلقائي، ولا يؤثر أي شيء هنا على ترحيل الفواتير العادي إلا بعد اكتمال الربط فعلياً.
 */
function ZatcaAdvancedPanel({ company, onChanged }) {
  const { t } = useTranslation();
  const STATUS_BADGE = {
    not_onboarded: { label: t("settings.zatca.statusNotOnboarded"), className: "status-badge" },
    compliance: { label: t("settings.zatca.statusCompliance"), className: "status-badge status-saved" },
    production: { label: t("settings.zatca.statusProduction"), className: "status-badge status-posted" },
  };
  const ENVIRONMENT_OPTIONS = [
    { value: "sandbox", label: t("settings.zatca.envSandbox") },
    { value: "simulation", label: t("settings.zatca.envSimulation") },
    { value: "production", label: t("settings.zatca.envProduction") },
  ];
  const INVOICE_TYPE_OPTIONS = [
    { value: "both", label: t("settings.zatca.invoiceTypeBoth") },
    { value: "standard", label: t("settings.zatca.invoiceTypeStandard") },
    { value: "simplified", label: t("settings.zatca.invoiceTypeSimplified") },
  ];

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [csrPem, setCsrPem] = useState("");
  const [invoiceType, setInvoiceType] = useState("both");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [complianceSteps, setComplianceSteps] = useState([]);
  const [stepResults, setStepResults] = useState({});
  // مستندات قبلتها زاتكا منذ بدء الأرشفة بلا أصل محفوظ — يجب أن يكون صفراً
  const [unarchived, setUnarchived] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [statusResult, stepsResult] = await Promise.all([
        getCompanyZatcaStatus(company.id),
        getCompanyZatcaComplianceSteps(company.id),
      ]);
      setStatus(statusResult);
      setComplianceSteps(stepsResult.steps || []);
      getUnarchivedZatcaDocuments(company.id).then(setUnarchived).catch(() => setUnarchived(null));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [company.id]);

  const runAction = async (fn, successNote) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await fn();
      setNote(successNote);
      await load();
      onChanged?.();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateCsr = () =>
    runAction(async () => {
      const result = await generateCompanyZatcaCsr(company.id, { invoiceType });
      setCsrPem(result.csrPem);
      return result;
    }, t("settings.zatca.csrSuccess"));

  const handleCompliance = () => {
    if (!otp.trim()) { setError(t("settings.zatca.errOtpRequired")); return; }
    return runAction(
      () => requestCompanyZatcaCompliance(company.id, otp.trim()),
      t("settings.zatca.complianceSuccess"),
    );
  };

  const handleProduction = () =>
    runAction(() => requestCompanyZatcaProduction(company.id), t("settings.zatca.productionSuccess"));

  const handleEnvironmentChange = (environment) =>
    runAction(() => setCompanyZatcaEnvironment(company.id, environment), t("settings.zatca.envChangeSuccess", { env: ENVIRONMENT_OPTIONS.find((o) => o.value === environment)?.label }));

  // مستند اصطناعي بالكامل (راجع src/lib/zatca/complianceAutomation.ts) — لا يمرّ عبر runAction
  // العام عمداً: رفض زاتكا للفحص هنا نتيجة متوقَّعة عادية يجب عرضها بوضوح (البند الفعلي)، لا
  // "خطأ" عام يُخفي السبب خلف رسالة نجاح/فشل عامة. نتيجة كل خطوة تُعرَض في سطرها الخاص بالجدول
  // (stepResults مفهرسة بمفتاح الخطوة)، لا في مكان واحد مشترك يُستبدَل عند تشغيل خطوة أخرى.
  const handleRunStepTest = async (stepKey) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await runCompanyZatcaComplianceStepTest(company.id, stepKey);
      setStepResults((prev) => ({ ...prev, [stepKey]: result }));
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    if (!window.confirm(t("settings.zatca.confirmReset"))) return;
    return runAction(() => resetCompanyZatcaLinkage(company.id), t("settings.zatca.resetSuccess"));
  };

  const badge = status ? STATUS_BADGE[status.onboardingStatus] || STATUS_BADGE.not_onboarded : null;

  return (
    <div data-testid="zatca-advanced-panel">
        {loading ? (
          <p className="note">{t("common.loading")}</p>
        ) : (
          <>
            {unarchived && unarchived.since && (
              <p className={unarchived.count ? "balance-bad" : "note"} data-testid="zatca-unarchived">
                {unarchived.count
                  ? t("settings.zatca.unarchivedBad", { count: unarchived.count, numbers: unarchived.latest.map((d) => d.documentNumber).join("، ") })
                  : t("settings.zatca.unarchivedOk", { since: String(unarchived.since).slice(0, 10) })}
              </p>
            )}
            <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
              <div>
                <span className="note" style={{ marginInlineEnd: 8 }}>{t("settings.zatca.currentStatusLabel")}</span>
                <span className={badge.className}>{badge.label}</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {t("settings.zatca.currentEnvLabel")}
                <select
                  value={status.environment}
                  disabled={busy}
                  onChange={(e) => handleEnvironmentChange(e.target.value)}
                >
                  {ENVIRONMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <p className="note">
              {t("settings.zatca.egsInfo", { egsUuid: status.egsUuid || "—", solutionName: status.solutionName || "—", nextIcv: status.nextIcv })}
            </p>

            <h4 className="sub-head">{t("settings.zatca.csrStepTitle")}</h4>
            <p className="note">{t("settings.zatca.csrStepNote")}</p>
            <label style={{ display: "block", marginBottom: 8 }}>
              {t("settings.zatca.invoiceTypeLabel")}
              <select value={invoiceType} disabled={busy} onChange={(e) => setInvoiceType(e.target.value)} style={{ display: "block", marginTop: 4 }}>
                {INVOICE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="note" style={{ display: "block", marginTop: 4 }}>{t("settings.zatca.invoiceTypeNote")}</span>
            </label>
            {status.csrInvoiceType && (
              <p className="note">
                {t("settings.zatca.currentInvoiceTypeLabel", {
                  type: INVOICE_TYPE_OPTIONS.find((o) => o.value === status.csrInvoiceType)?.label || status.csrInvoiceType,
                })}
              </p>
            )}
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <button className="btn-ghost" onClick={handleGenerateCsr} disabled={busy}>
                {status.hasCsr ? t("settings.zatca.regenerateCsrBtn") : t("settings.zatca.generateCsrBtn")}
              </button>
            </div>
            {csrPem && (
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  {t("settings.zatca.csrTextLabel")}
                  <textarea readOnly rows={6} value={csrPem} onClick={(e) => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
                </label>
              </div>
            )}

            <h4 className="sub-head">{t("settings.zatca.complianceStepTitle")}</h4>
            <p className="note">{t("settings.zatca.complianceStepNote")}</p>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <input type="text" placeholder={t("settings.zatca.otpPlaceholder")} value={otp} onChange={(e) => setOtp(e.target.value)} style={{ maxWidth: 200 }} disabled={busy} />
              <button className="btn-ghost" onClick={handleCompliance} disabled={busy || !status.hasCsr}>
                {t("settings.zatca.requestComplianceBtn")}
              </button>
            </div>

            <h4 className="sub-head">{t("settings.zatca.complianceStepsProgressTitle")}</h4>
            <p className="note">{t("settings.zatca.complianceStepsProgressNote")}</p>
            <p className="note">{t("settings.zatca.complianceStepsWarning")}</p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
              {complianceSteps.map((step) => {
                const result = stepResults[step.key];
                return (
                  <li key={step.key} style={{ padding: "6px 0", borderBottom: "1px solid var(--border, #eee)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span>{t(`settings.zatca.complianceStepLabels.${step.key}`)}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={step.passed ? "status-badge status-posted" : "status-badge"}>
                          {step.passed ? t("settings.zatca.stepPassed") : t("settings.zatca.stepPending")}
                        </span>
                        {!step.passed && step.enabled && (
                          <button className="btn-ghost" onClick={() => handleRunStepTest(step.key)} disabled={busy || !status.hasComplianceCertificate}>
                            {t("settings.zatca.runComplianceStepTestBtn")}
                          </button>
                        )}
                        {!step.passed && !step.enabled && (
                          <span className="note">{t("settings.zatca.stepNotEnabledYet")}</span>
                        )}
                      </div>
                    </div>
                    {result && (
                      result.passed ? (
                        <p className="note" style={{ color: "var(--ok, green)", margin: "4px 0 0" }}>
                          {t("settings.zatca.complianceStepTestPassed", { status: result.zatcaStatus })}
                        </p>
                      ) : (
                        <p className="balance-bad" style={{ margin: "4px 0 0" }}>
                          {t("settings.zatca.complianceStepTestFailed", { reason: result.rejectionReason || result.zatcaStatus })}
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>

            <h4 className="sub-head">{t("settings.zatca.productionStepTitle")}</h4>
            <p className="note">{t("settings.zatca.productionStepNote")}</p>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <button className="btn-primary" onClick={handleProduction} disabled={busy || !status.hasComplianceCertificate}>
                {t("settings.zatca.requestProductionBtn")}
              </button>
            </div>

            {note && <p className="note" style={{ color: "var(--ok, green)" }}>{note}</p>}
            {error && <p className="balance-bad">{error}</p>}

            <h4 className="sub-head">{t("settings.zatca.resetTitle")}</h4>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <button className="btn-ghost" onClick={handleReset} disabled={busy}>{t("settings.zatca.resetBtn")}</button>
            </div>
          </>
        )}
    </div>
  );
}


const STAGE_KEYS = ["validate", "certificate", "complianceChecks", "activation"];
const FATOORA_PORTAL_URL = "https://fatoora.zatca.gov.sa/";

/**
 * نافذة ربط فاتورة (ZATCA) — خطوة واحدة: رمز OTP من منصة فاتورة وزر واحد، والخادم ينفّذ كل شيء
 * (راجع src/modules/companiesZatca/zatcaOneStepOnboarding.ts). التفاصيل التقنية وكل الخطوات اليدوية
 * مخفية تحت "خيارات متقدمة".
 */
export default function CompanyZatcaModal({ company, onClose }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState("production");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stages, setStages] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  const loadStatus = async () => {
    try {
      const s = await getCompanyZatcaStatus(company.id);
      setStatus(s);
      // بيئة الشركة الافتراضية في قاعدة البيانات sandbox؛ للمستخدم العادي الافتراضي هو الإنتاج، إلا إن
      // كان هناك ربط غير مكتمل على بيئة أخرى فنُبقي بيئته حتى يُستأنَف عليها.
      setEnvironment(s.onboardingStatus === "compliance" ? s.environment : "production");
    } catch (err) {
      setError({ message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, [company.id]);

  const resuming = status?.onboardingStatus === "compliance" && status?.hasComplianceCertificate;
  const linked = status?.onboardingStatus === "production";

  const handleConnect = async () => {
    const code = otp.trim();
    if (!resuming && !/^\d{6}$/.test(code)) {
      setError({ message: t("settings.zatca.oneStep.errOtpFormat") });
      return;
    }
    setBusy(true);
    setError(null);
    setStages(null);
    setShowTechnical(false);
    try {
      const result = await onboardCompanyZatca(company.id, { otp: code || undefined, environment });
      setStages(result.stages);
      setStatus(result.status);
      setOtp("");
    } catch (err) {
      setError({ message: err.message, details: err.details || null });
      if (err.details?.stages) setStages(err.details.stages);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const stageIcon = (st) => (st === "done" || st === "skipped" ? "✓" : st === "failed" ? "✕" : "•");
  const stageClass = (st) => (st === "done" || st === "skipped" ? "note" : st === "failed" ? "balance-bad" : "note");

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="invoice-modal-box">
        <div className="modal-title-row">
          <h3>{t("settings.zatca.modalTitle", { name: company.name })}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label={t("common.close")}>×</button>
        </div>

        {loading ? (
          <p className="note">{t("common.loading")}</p>
        ) : linked ? (
          <div data-testid="zatca-linked">
            <p><span className="status-badge status-posted">{t("settings.zatca.oneStep.linkedTitle")}</span></p>
            <p className="note">{t("settings.zatca.oneStep.linkedNote")}</p>
          </div>
        ) : (
          <div data-testid="zatca-one-step">
            {resuming ? (
              <p className="note">{t("settings.zatca.oneStep.resumeNote")}</p>
            ) : (
              <>
                <p className="note">{t("settings.zatca.oneStep.intro")}</p>
                <ol className="note" style={{ paddingInlineStart: 20, margin: "0 0 12px" }}>
                  <li>
                    {t("settings.zatca.oneStep.howTo1")}{" "}
                    <a href={FATOORA_PORTAL_URL} target="_blank" rel="noopener noreferrer">fatoora.zatca.gov.sa</a>
                  </li>
                  <li>{t("settings.zatca.oneStep.howTo2")}</li>
                  <li>{t("settings.zatca.oneStep.howTo3")}</li>
                </ol>
              </>
            )}

            <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
              {!resuming && (
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  dir="ltr"
                  placeholder={t("settings.zatca.oneStep.otpPlaceholder")}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  disabled={busy}
                  style={{ maxWidth: 160, textAlign: "center", letterSpacing: 4 }}
                />
              )}
              <button className="btn-primary" onClick={handleConnect} disabled={busy}>
                {busy
                  ? t("settings.zatca.oneStep.connecting")
                  : resuming
                    ? t("settings.zatca.oneStep.resumeBtn")
                    : t("settings.zatca.oneStep.connectBtn")}
              </button>
            </div>

            {busy && <p className="note">{t("settings.zatca.oneStep.busyNote")}</p>}

            {stages && (
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }} data-testid="zatca-stages">
                {STAGE_KEYS.map((key) => {
                  const st = stages.find((s) => s.key === key)?.status || "pending";
                  return (
                    <li key={key} className={stageClass(st)} style={{ padding: "2px 0" }}>
                      {stageIcon(st)} {t(`settings.zatca.oneStep.stages.${key}`)}
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <div style={{ marginTop: 8 }}>
                <p className="balance-bad">{error.message}</p>
                {Array.isArray(error.details?.missingFields) && error.details.missingFields.length > 0 && (
                  <ul className="balance-bad" style={{ margin: "4px 0", paddingInlineStart: 20 }}>
                    {error.details.missingFields.map((f) => (
                      <li key={f}>{t(`settings.zatca.oneStep.fields.${f}`)}</li>
                    ))}
                  </ul>
                )}
                {error.details?.technical && (
                  <>
                    <button type="button" className="btn-ghost" onClick={() => setShowTechnical((v) => !v)} style={{ fontSize: 12 }}>
                      {showTechnical ? t("settings.zatca.oneStep.hideTechnical") : t("settings.zatca.oneStep.showTechnical")}
                    </button>
                    {showTechnical && (
                      <pre dir="ltr" style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 160, overflow: "auto" }}>
                        {String(error.details.technical)}
                      </pre>
                    )}
                  </>
                )}
              </div>
            )}

            {!busy && (
              <p className="note" style={{ marginTop: 12 }}>
                {t("settings.zatca.oneStep.envLabel")}{" "}
                <select value={environment} onChange={(e) => setEnvironment(e.target.value)} disabled={busy || resuming}>
                  <option value="production">{t("settings.zatca.envProduction")}</option>
                  <option value="simulation">{t("settings.zatca.envSimulation")}</option>
                  <option value="sandbox">{t("settings.zatca.envSandbox")}</option>
                </select>
              </p>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border, #eee)", paddingTop: 8 }}>
          <button type="button" className="btn-ghost" onClick={() => setShowAdvanced((v) => !v)} disabled={busy} style={{ fontSize: 12 }}>
            {showAdvanced ? t("settings.zatca.oneStep.hideAdvanced") : t("settings.zatca.oneStep.showAdvanced")}
          </button>
          {showAdvanced && <ZatcaAdvancedPanel company={company} onChanged={loadStatus} />}
        </div>

        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
