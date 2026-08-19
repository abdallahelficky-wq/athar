import React from "react";
import { fmt } from "../legacy/constants";

const PRICING_PLANS = [
  {
    name: "الأساسية", price: 500,
    tagline: "للمنشآت الناشئة وأصحاب المشاريع الصغيرة",
    features: ["شركة واحدة", "القيود والتقارير المالية الأساسية", "فواتير مبيعات ومشتريات متوافقة مع زاتكا", "حتى 5 مستخدمين", "دعم فني عبر البريد الإلكتروني"],
  },
  {
    name: "الاحترافية", price: 1000, highlighted: true,
    tagline: "للمجموعات متعددة الشركات والفرق المحاسبية",
    features: ["حتى 4 شركات ضمن مجموعة واحدة", "كل مزايا الباقة الأساسية", "المخزون والأصول الثابتة", "شئون الموظفين والرواتب بالكامل", "دعم فني ذو أولوية"],
  },
  {
    name: "المؤسسات", price: 1500,
    tagline: "للمجموعات الكبيرة ذات الاحتياجات المتقدمة",
    features: ["عدد غير محدود من الشركات", "كل مزايا الباقة الاحترافية", "صلاحيات مستخدمين متقدمة", "استيراد وتصدير إكسل غير محدود", "مدير حساب مخصص"],
  },
];

const WHY_US = [
  { title: "متوافق مع زاتكا", desc: "فواتير ضريبية إلكترونية (قياسية ومبسّطة) برمز QR فعلي، مبنية من الأساس وفق متطلبات هيئة الزكاة والضريبة والجمارك." },
  { title: "مجموعة كاملة في مكان واحد", desc: "تدير كل شركاتك من شاشة واحدة، مع فصل كامل لبيانات كل شركة وتقارير موحّدة للمجموعة ككل." },
  { title: "دورة موظف كاملة", desc: "من التعيين والإجازات والرواتب وحتى مكافأة نهاية الخدمة، محسوبة وفق نظام العمل السعودي." },
  { title: "تقارير مالية فورية", desc: "ميزان المراجعة وقائمة الدخل والمركز المالي تتحدّث لحظياً مع كل قيد وفاتورة تسجّلها." },
  { title: "دورة مبيعات ومشتريات متكاملة", desc: "من عرض السعر إلى الفاتورة إلى سند القبض، ومن أمر الشراء إلى فاتورة المورد، بربط محاسبي تلقائي كامل." },
  { title: "واجهة عربية أصيلة", desc: "مصمَّمة من الصفر لتناسب طريقة عمل المحاسب العربي، لا واجهة مترجمة عن نظام أجنبي." },
];

export default function LandingPage({ onGoLogin, onGoRegister }) {
  return (
    <div className="landing-root">
      <header className="landing-nav">
        <div className="landing-brand">
          <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <span>أثر المحاسبي</span>
        </div>
        <div className="landing-nav-actions">
          <button className="btn-ghost" onClick={onGoLogin}>تسجيل الدخول</button>
          <button className="btn-primary" onClick={onGoRegister}>ابدأ تجربتك المجانية</button>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-eyebrow">نظام محاسبي سحابي عربي</div>
        <h1>أثر المحاسبي</h1>
        <p className="landing-hero-sub">
          نظام محاسبي سحابي شامل لإدارة مجموعتك التجارية بالكامل — من القيود والفواتير الضريبية المتوافقة مع زاتكا،
          إلى المخزون والأصول الثابتة وشئون الموظفين والرواتب — في مكان واحد، وبواجهة عربية مصمَّمة من الأساس.
        </p>
        <div className="landing-hero-actions">
          <button className="btn-primary landing-cta" onClick={onGoRegister}>جرّب مجاناً لمدة شهر كامل</button>
          <button className="btn-ghost landing-cta" onClick={onGoLogin}>لدي حساب بالفعل</button>
        </div>
      </section>

      <section className="landing-section">
        <div className="section-title landing-section-title">
          <span className="eyebrow">من نحن</span>
          <h2>نبذة عن أثر المحاسبي</h2>
        </div>
        <p className="landing-about-text">
          أثر المحاسبي نظام محاسبي سحابي مبني خصيصاً لبيئة الأعمال السعودية، يهدف إلى تبسيط العمل المحاسبي اليومي
          لأصحاب الشركات والمحاسبين على حد سواء. صُمّم النظام ليغطي دورة العمل الكاملة لأي منشأة أو مجموعة شركات:
          من التأسيس المحاسبي (شجرة الحسابات والقيود اليومية)، مروراً بالمبيعات والمشتريات والمخزون والأصول الثابتة،
          وصولاً إلى إدارة الموظفين ورواتبهم واستحقاقاتهم. كل ذلك مع الالتزام الكامل بمتطلبات هيئة الزكاة والضريبة
          والجمارك في الفوترة الإلكترونية، وبناء تقارير مالية دقيقة تعكس الصورة الحقيقية لأداء المنشأة في أي لحظة.
        </p>
      </section>

      <section className="landing-section">
        <div className="section-title landing-section-title">
          <span className="eyebrow">لماذا أثر المحاسبي</span>
          <h2>مصمَّم ليناسب طريقة عملك</h2>
        </div>
        <div className="why-us-grid">
          {WHY_US.map((w) => (
            <div className="why-us-card" key={w.title}>
              <div className="why-us-title">{w.title}</div>
              <div className="why-us-desc">{w.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="pricing">
        <div className="section-title landing-section-title">
          <span className="eyebrow">الأسعار</span>
          <h2>باقات تناسب حجم أعمالك</h2>
        </div>
        <div className="trial-banner">✨ جميع الباقات تشمل تجربة مجانية كاملة لمدة شهر — بدون أي التزام</div>
        <div className="pricing-grid">
          {PRICING_PLANS.map((p) => (
            <div className={"pricing-card" + (p.highlighted ? " pricing-highlighted" : "")} key={p.name}>
              {p.highlighted && <div className="pricing-badge">الأكثر اختياراً</div>}
              <div className="pricing-plan-name">{p.name}</div>
              <div className="pricing-plan-tagline">{p.tagline}</div>
              <div className="pricing-price"><span className="pricing-amount">{fmt(p.price)}</span> ر.س / سنوياً</div>
              <div className="pricing-monthly-option">أو {fmt((p.price / 12) * 1.10)} ريال/شهر عند الدفع الشهري</div>
              <ul className="pricing-features">
                {p.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button className={p.highlighted ? "btn-primary" : "btn-ghost"} onClick={onGoRegister} style={{ width: "100%" }}>ابدأ التجربة المجانية</button>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div>© 2026 أثر المحاسبي — جميع الحقوق محفوظة</div>
        <button className="btn-ghost" onClick={onGoLogin}>تسجيل الدخول</button>
      </footer>
    </div>
  );
}
