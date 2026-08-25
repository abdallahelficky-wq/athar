import React from "react";

/**
 * أيقونات القائمة الجانبية — بنفس أسلوب Icon في shared.jsx (خطوط SVG بسيطة، viewBox 24x24،
 * currentColor) لكن بمجموعة مفاتيح مستقلة تغطي كل الأقسام الرئيسية وكل عنصر فرعي، لتحسين
 * القابلية للمسح البصري السريع للقائمة. بعض المفاتيح تتشارك نفس الأيقونة عبر أقسام مختلفة عمداً
 * (مثلاً "reports" في كل قسم تُستخدَم لها أيقونة رسم بياني واحدة) لأن المفهوم البصري متطابق.
 */
const svg = (children) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const NAV_ICONS = {
  dashboard: svg(<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="12" width="8" height="9" rx="1.5" /><rect x="3" y="14" width="8" height="7" rx="1.5" /></>),

  sales: svg(<><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /><path d="M2 3h2l2.6 12.6a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6" /></>),
  purchases: svg(<><path d="M3 7h13l3 4v6a1 1 0 0 1-1 1h-1" /><path d="M16 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a1 1 0 0 0 1 1h1" /><circle cx="7.5" cy="17.5" r="1.7" /><circle cx="17.5" cy="17.5" r="1.7" /></>),
  inventory: svg(<><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>),
  stables: svg(<><path d="M3 21V8l9-5 9 5v13"/><path d="M3 10h18M8 21v-7h8v7"/><circle cx="12" cy="11" r="1"/></>),
  overview: svg(<><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></>),
  stalls: svg(<><path d="M4 21V5h16v16M4 10h16M9 10v11M15 10v11"/></>),
  horses: svg(<><path d="M5 20c2-5 1-9 4-12 2-2 5-3 9-2l-2 3 2 3-4 1c0 4-2 7-5 7z"/><path d="M8 20h10"/></>),
  contracts: svg(<><path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4M9 12h6M9 16h6"/></>),
  care: svg(<><path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11z"/><path d="M9 12h6M12 9v6"/></>),
  fixedAssets: svg(<><path d="M4 21V9l8-5 8 5v12" /><path d="M9 21v-6h6v6" /><path d="M4 21h16" /></>),
  accounts: svg(<><path d="M12 5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z" /><path d="M12 5v13" /></>),
  hr: svg(<><circle cx="8.5" cy="8" r="3" /><path d="M2 20c0-3.3 2.9-6 6.5-6S15 16.7 15 20" /><circle cx="17" cy="8.5" r="2.3" /><path d="M15.5 13.2c2.6.5 4.5 2.6 4.5 5.3" /></>),
  reports: svg(<><path d="M4 20V10" /><path d="M11 20V4" /><path d="M18 20v-7" /><path d="M2 20h20" /></>),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.4.3.9.6 1.6.6H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z" /></>),

  customers: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>),
  quotations: svg(<><path d="M6 2h9l4 4v16H6z" /><path d="M15 2v4h4" /><path d="M9 13h6M9 17h6" /></>),
  invoices: svg(<><path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z" /><path d="M9 8h6M9 12h6" /></>),
  returns: svg(<><path d="M3 10a8 8 0 1 1 2.3 5.6" /><path d="M3 4v6h6" /></>),
  receipts: svg(<><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><path d="M6 15h4" /></>),
  stations: svg(<><path d="M4 21V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15" /><path d="M4 21h9" /><path d="M13 10h2a2 2 0 0 1 2 2v3.5a1.5 1.5 0 0 0 3 0V9l-3-3" /><path d="M6 8h5" /></>),

  suppliers: svg(<><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></>),
  byCustomer: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>),
  bySupplier: svg(<><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></>),
  monthly: svg(<><path d="M3 17l4-5 3 3 5-7 4 5" /><path d="M3 20h18" /></>),
  aging: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>),
  vat: svg(<><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M5 19L19 5" /></>),

  items: svg(<><rect x="3" y="7" width="18" height="14" rx="1.5" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  inout: svg(<><path d="M7 8l-4 4 4 4" /><path d="M3 12h11" /><path d="M17 4l4 4-4 4" /><path d="M21 8H10" /></>),
  issue: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>),
  transfer: svg(<><path d="M17 3l4 4-4 4" /><path d="M3 11V9a2 2 0 0 1 2-2h16" /><path d="M7 21l-4-4 4-4" /><path d="M21 13v2a2 2 0 0 1-2 2H3" /></>),
  report: svg(<><path d="M4 20V10" /><path d="M11 20V4" /><path d="M18 20v-7" /><path d="M2 20h20" /></>),

  register: svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 3v3h6V3" /><path d="M8 11h8M8 15h5" /></>),
  depreciation: svg(<><path d="M3 7l7 7 4-4 7 7" /><path d="M15 6h6v6" /></>),
  disposal: svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2M6 6l1 15h10l1-15" /></>),
  categories: svg(<><rect x="3" y="3" width="7" height="7" rx="1.3" /><rect x="14" y="3" width="7" height="7" rx="1.3" /><rect x="3" y="14" width="7" height="7" rx="1.3" /><rect x="14" y="14" width="7" height="7" rx="1.3" /></>),

  journal: svg(<><path d="M12 5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z" /><path d="M12 5v13" /></>),
  chartOfAccounts: svg(<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 7v10" /><path d="M6 12h10" /></>),
  zakat: svg(<><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M5 19L19 5" /></>),

  directory: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>),
  leaves: svg(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /></>),
  leaveSettlement: svg(<><circle cx="12" cy="12" r="9" /><path d="M9 12h6M9 15h4" /><path d="M12 6v2" /></>),
  leaveReturn: svg(<><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M13 17l5-5-5-5" /><path d="M18 12H9" /></>),
  actions: svg(<><path d="M12 2l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 14l-5 3 1.2-5.6L4 7.6 9.6 7z" /></>),
  payroll: svg(<><rect x="2.5" y="6" width="19" height="13" rx="2" /><circle cx="12" cy="12.5" r="2.6" /><path d="M5 10.5h1M18 14.5h1" /></>),
  eos: svg(<><path d="M6 3v18" /><path d="M6 4h11l-3 4 3 4H6" /></>),

  trial: svg(<><path d="M12 3v3" /><path d="M4 8h16" /><path d="M6 8l-3 6a3 3 0 0 0 6 0z" /><path d="M18 8l-3 6a3 3 0 0 0 6 0z" /></>),
  income: svg(<><path d="M3 17l5-5 4 4 8-8" /><path d="M14 8h6v6" /></>),
  balance: svg(<><path d="M4 21V10l8-6 8 6v11" /><path d="M9 21v-7h6v7" /></>),

  companies: svg(<><path d="M4 21V9l8-5 8 5v12" /><path d="M9 21v-6h6v6" /><path d="M4 21h16" /></>),
  profile: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 3-6.5 6.5-6.5S15.5 16.4 15.5 20" /><circle cx="17" cy="8.5" r="2.3" /><path d="M15.8 13.6c2.4.6 4.2 2.6 4.2 6.4" /></>),
  jobTitles: svg(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  locations: svg(<><path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.3" /></>),
  companyDocs: svg(<><path d="M6 2h9l4 4v16H6z" /><path d="M15 2v4h4" /><path d="M9 12h6M9 16h6" /></>),
};

export function NavIcon({ name }) {
  return NAV_ICONS[name] || NAV_ICONS.dashboard;
}

