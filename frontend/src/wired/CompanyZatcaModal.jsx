import React, { useEffect, useState } from "react";
import {
  getCompanyZatcaStatus,
  generateCompanyZatcaCsr,
  requestCompanyZatcaCompliance,
  requestCompanyZatcaProduction,
  setCompanyZatcaEnvironment,
  resetCompanyZatcaLinkage,
} from "../api/companies";

const STATUS_BADGE = {
  not_onboarded: { label: "غير مفعّل", className: "status-badge" },
  compliance: { label: "بيئة اختبار (Compliance)", className: "status-badge status-saved" },
  production: { label: "الإنتاج (مفعّلة)", className: "status-badge status-posted" },
};

const ENVIRONMENT_OPTIONS = [
  { value: "sandbox", label: "بيئة المطورين العامة (Sandbox)" },
  { value: "simulation", label: "محاكاة بحساب الشركة (Simulation)" },
  { value: "production", label: "الإنتاج الفعلي (Production)" },
];

/**
 * نافذة ربط فاتورة (ZATCA) لشركة واحدة — توليد CSR، طلب شهادة اختبار (Compliance) عبر OTP يحصل
 * عليه مسؤول الشركة من بوابة فاتورة الحقيقية، ثم استبدالها بشهادة إنتاج فعلية، مع تبديل البيئة
 * وعرض حالة الربط الحالية بوضوح. كل خطوة اختيارية تماماً (opt-in) لكل شركة على حدة — لا تفعيل
 * تلقائي، ولا يؤثر أي شيء هنا على ترحيل الفواتير العادي إلا بعد اكتمال الربط فعلياً.
 */
export default function CompanyZatcaModal({ company, onClose }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [csrPem, setCsrPem] = useState("");
  const [production, setProduction] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setStatus(await getCompanyZatcaStatus(company.id));
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
      const result = await generateCompanyZatcaCsr(company.id, { production });
      setCsrPem(result.csrPem);
      return result;
    }, "تم توليد CSR بنجاح — انسخه وقدّمه في بوابة فاتورة الحقيقية للحصول على رمز التحقق (OTP).");

  const handleCompliance = () => {
    if (!otp.trim()) { setError("رمز التحقق (OTP) مطلوب"); return; }
    return runAction(
      () => requestCompanyZatcaCompliance(company.id, otp.trim()),
      "تم استخراج شهادة الاختبار (Compliance CSID) بنجاح.",
    );
  };

  const handleProduction = () =>
    runAction(() => requestCompanyZatcaProduction(company.id), "تم استخراج شهادة الإنتاج (Production CSID) بنجاح — الشركة الآن جاهزة للتشغيل الفعلي.");

  const handleEnvironmentChange = (environment) =>
    runAction(() => setCompanyZatcaEnvironment(company.id, environment), `تم التحويل إلى بيئة: ${ENVIRONMENT_OPTIONS.find((o) => o.value === environment)?.label}`);

  const handleReset = () => {
    if (!window.confirm("سيؤدي هذا لمسح كل شهادات/مفاتيح الربط الحالية والعودة لحالة \"غير مفعّل\". لن يؤثر على الفواتير المرحّلة سابقاً. متابعة؟")) return;
    return runAction(() => resetCompanyZatcaLinkage(company.id), "تم مسح ربط زاتكا وإعادة الشركة لحالة \"غير مفعّل\".");
  };

  const badge = status ? STATUS_BADGE[status.onboardingStatus] || STATUS_BADGE.not_onboarded : null;

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="invoice-modal-box">
        <div className="modal-title-row">
          <h3>ربط فاتورة (ZATCA) — {company.name}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">×</button>
        </div>

        {loading ? (
          <p className="note">جارٍ التحميل...</p>
        ) : (
          <>
            <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
              <div>
                <span className="note" style={{ marginInlineEnd: 8 }}>حالة الربط الحالية:</span>
                <span className={badge.className}>{badge.label}</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                البيئة الحالية
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
              معرّف جهاز الفوترة (EGS): {status.egsUuid || "—"} — الحل: {status.solutionName || "—"} — عدّاد الفواتير التالي (ICV): {status.nextIcv}
            </p>

            <h4 className="sub-head">1) توليد طلب توقيع الشهادة (CSR)</h4>
            <p className="note">
              يُولَّد مفتاح تشفير خاص بهذه الشركة تحديداً (لا يُشارَك مع أي شركة أخرى) و CSR يجب تقديمه
              في بوابة فاتورة الحقيقية (زاتكا) للحصول على رمز تحقق (OTP) خاص بهذا الجهاز.
            </p>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={production} onChange={(e) => setProduction(e.target.checked)} />
                توليد لبيئة الإنتاج مباشرة (بدل الاختبار)
              </label>
              <button className="btn-ghost" onClick={handleGenerateCsr} disabled={busy}>
                {status.hasCsr ? "إعادة توليد CSR" : "توليد CSR"}
              </button>
            </div>
            {csrPem && (
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  نص CSR (انسخه لتقديمه في بوابة فاتورة)
                  <textarea readOnly rows={6} value={csrPem} onClick={(e) => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
                </label>
              </div>
            )}

            <h4 className="sub-head">2) طلب شهادة الاختبار (Compliance CSID)</h4>
            <p className="note">أدخل رمز التحقق (OTP) الذي حصلت عليه من بوابة فاتورة الحقيقية بعد تقديم CSR أعلاه.</p>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <input type="text" placeholder="رمز التحقق OTP" value={otp} onChange={(e) => setOtp(e.target.value)} style={{ maxWidth: 200 }} disabled={busy} />
              <button className="btn-ghost" onClick={handleCompliance} disabled={busy || !status.hasCsr}>
                طلب شهادة الاختبار
              </button>
            </div>

            <h4 className="sub-head">3) طلب شهادة الإنتاج (Production CSID)</h4>
            <p className="note">
              بعد نجاح شهادة الاختبار، واختبار الفواتير التجريبية عبر بوابة فاتورة، يمكن استبدالها بشهادة إنتاج فعلية صالحة لسنة تقريباً.
            </p>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <button className="btn-primary" onClick={handleProduction} disabled={busy || !status.hasComplianceCertificate}>
                طلب شهادة الإنتاج
              </button>
            </div>

            {note && <p className="note" style={{ color: "var(--ok, green)" }}>{note}</p>}
            {error && <p className="balance-bad">{error}</p>}

            <h4 className="sub-head">إعادة الضبط</h4>
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <button className="btn-ghost" onClick={handleReset} disabled={busy}>مسح الربط والبدء من جديد</button>
            </div>
          </>
        )}

        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}
