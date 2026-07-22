import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

export default function RegisterPage({ onGoLanding, onGoLogin }) {
  const { register } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!companyName || !name || !email || !password) { setError("يرجى تعبئة كل الحقول."); return; }
    if (password !== confirmPassword) { setError("كلمتا المرور غير متطابقتين."); return; }
    if (password.length < 8) { setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل."); return; }
    setSubmitting(true);
    setError("");
    try {
      await register({ tenantName: companyName, name, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر إنشاء الحساب، حاول مجدداً.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="landing-brand auth-brand">
          <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <span>أثر المحاسبي</span>
        </div>
        <h2 className="auth-title">ابدأ تجربتك المجانية لمدة شهر</h2>
        <div className="auth-form">
          <label>اسم الشركة / المنشأة<input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></label>
          <label>الاسم الكامل<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>البريد الإلكتروني<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>كلمة المرور<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>تأكيد كلمة المرور<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
          {error && <p className="balance-bad">{error}</p>}
          <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
            {submitting ? "جارٍ الإنشاء..." : "إنشاء الحساب وبدء التجربة"}
          </button>
        </div>
        <div className="auth-links">
          <button className="link-btn" onClick={onGoLogin}>لديك حساب بالفعل؟ سجّل الدخول</button>
          <button className="link-btn" onClick={onGoLanding}>الرجوع للصفحة الرئيسية</button>
        </div>
        <p className="note auth-note">
          عند إنشاء الحساب يُنشأ مستأجر جديد معزول تماماً في قاعدة البيانات، مع شجرة حسابات افتراضية جاهزة،
          وتجربة مجانية لمدة 30 يوماً.
        </p>
      </div>
    </div>
  );
}
