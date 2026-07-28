import React from "react";

// لوحة ألوان مميزة بصرياً (تباين كافٍ بين كل لون والتالي له) — يُختار منها لون ثابت لكل شركة
// بناءً على تجزئة (hash) معرّفها (id)، وليس عشوائياً في كل تحميل للصفحة، حتى تحتفظ كل شركة
// بنفس اللون دائماً بصرف النظر عن ترتيب ظهورها أو عدد مرات إعادة تحميل الصفحة.
const AVATAR_COLORS = ["#2F5D5A", "#8A5A3E", "#B98B4E", "#445565", "#A8432B", "#10202E", "#6B4E8A", "#1F6F5C"];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash;
}

/** لون ثابت لكل شركة مشتق من معرّفها — نفس اللون دائماً لنفس الشركة */
export function getCompanyColor(id) {
  return AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length];
}

// بادئات عامة شائعة في الأسماء التجارية العربية ("شركة"، "مؤسسة"...) لا تُميّز شركة عن أخرى —
// تُحذف قبل استخراج الحرفين الأوّلين حتى لا تتطابق أحرف شركات مختلفة (كانت كل الشركات التي
// يبدأ اسمها الرسمي بكلمة "شركة" تظهر بنفس الحرف "ش" رغم اختلافها فعلياً)
const GENERIC_PREFIXES = ["شركة ", "مؤسسة ", "مجموعة ", "company ", "Company "];

function meaningfulName(company) {
  const raw = (company.shortName || company.name || "").trim();
  for (const prefix of GENERIC_PREFIXES) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim() || raw;
  }
  return raw;
}

/** أول حرفين مميّزين من الاسم (بعد حذف البادئات العامة) بدل حرف واحد فقط */
export function getCompanyInitials(company) {
  const name = meaningfulName(company);
  return name.slice(0, 2) || "؟";
}

function GroupIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}

function CompanyCard({ company, active, onClick }) {
  return (
    <button className={"company-card" + (active ? " active" : "")} onClick={onClick} title={company.name}>
      {company.logoUrl ? (
        <img src={company.logoUrl} alt={company.name} className="company-card-logo" />
      ) : (
        <div className="company-card-avatar" style={{ background: getCompanyColor(company.id) }}>
          {getCompanyInitials(company)}
        </div>
      )}
      <span className="company-card-name">{company.shortName || company.name}</span>
    </button>
  );
}

function ConsolidatedCard({ active, onClick, label }) {
  return (
    <button className={"company-card company-card-consolidated" + (active ? " active" : "")} onClick={onClick}>
      <div className="company-card-avatar company-card-avatar-consolidated"><GroupIcon /></div>
      <span className="company-card-name">{label}</span>
    </button>
  );
}

/**
 * صف بطاقات اختيار الشركة — Component مشترك لأي شاشة تحتاج اختيار "الشركة النشطة" بنفس الشكل
 * والسلوك (الداشبورد المالية اليوم، وأي داشبورد أخرى مستقبلية كشئون الموظفين). مُمركَز أفقياً
 * دائماً بنفس مبدأ شريط التبويبات الفرعي (SubTabs) لاتساق بصري عبر الشاشة كلها.
 */
export default function CompanyCards({ companies, activeCompanyId, consolidatedActive, onSelectCompany, onSelectConsolidated, showConsolidated = true, consolidatedLabel = "المجموعة كاملة" }) {
  return (
    <div className="company-cards-row">
      {companies.map((c) => (
        <CompanyCard
          key={c.id}
          company={c}
          active={!consolidatedActive && activeCompanyId === c.id}
          onClick={() => onSelectCompany(c.id)}
        />
      ))}
      {showConsolidated && (
        <ConsolidatedCard active={!!consolidatedActive} onClick={onSelectConsolidated} label={consolidatedLabel} />
      )}
    </div>
  );
}
