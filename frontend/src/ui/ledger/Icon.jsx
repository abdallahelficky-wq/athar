import React from 'react';
const paths = {
  dashboard: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  sales: <path d="M5 20V4h14v16l-3-2-4 2-4-2zM8 8h8m-8 4h5" />,
  purchases: <path d="M4 8h16l-1 12H5zM8 8V6a4 4 0 0 1 8 0v2" />,
  inventory: <path d="m3 7 9-4 9 4-9 5zM3 7v10l9 4 9-4V7M12 12v9" />,
  accounts: <path d="M12 5C8 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-5-1-9 1zm0 0v15" />,
  hr: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2" /></>,
  reports: <path d="M4 3v18h17M8 17v-5m5 5V7m5 10V4" />,
  fixedAssets: <path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6M2 20h20" />,
  settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  plus: <path d="M12 4v16M4 12h16" />,
  // أيقونات تبويبات المبيعات الفرعية (WorkflowSteps) — بنفس أسلوب رسم الأيقونات أعلاه.
  invoices: <><path d="M6 2h9l3 3v17H6z" /><path d="M9 8h7M9 12h7M9 16h4" /></>,
  customers: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>,
  quotations: <><path d="M11 3h7a2 2 0 0 1 2 2v7l-9 9-9-9 9-9z" /><circle cx="15.5" cy="8.5" r="1.5" /></>,
  returns: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v1" /></>,
  receipts: <><path d="M7 2h10v17l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1V2z" /><path d="M9 7h6M9 11h4" /></>,
  stations: <><path d="M3 9l1-5h16l1 5" /><path d="M4 9v10h16V9" /><path d="M9 19v-5h6v5" /></>,
  // أيقونات تبويبات الحسابات الفرعية (WorkflowSteps) — بنفس أسلوب رسم الأيقونات أعلاه.
  journal: <><path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  chartOfAccounts: <><rect x="10" y="2" width="4" height="4" rx="1" /><rect x="3" y="17" width="4" height="4" rx="1" /><rect x="17" y="17" width="4" height="4" rx="1" /><path d="M12 6v4M12 10H5v7M12 10h7v7" /></>,
  ledger: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M12 3v18M7 8h2M7 12h2M7 16h2M15 8h2M15 12h2M15 16h2" /></>,
  departments: <><rect x="3" y="10" width="7" height="11" rx="1" /><rect x="14" y="6" width="7" height="15" rx="1" /><path d="M6 14h1M6 17h1M17 10h1M17 13h1M17 16h1" /></>,
};
export default function Icon({ name = 'dashboard' }) {
  return <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name] || paths.dashboard}</svg>;
}
