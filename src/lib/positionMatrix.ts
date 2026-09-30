export const MATRIX_ACTIONS = ["read", "create", "edit", "delete", "approve"] as const;
export type MatrixAction = (typeof MATRIX_ACTIONS)[number];
export const MATRIX_MARKER = "__position_matrix_v1__";
export const POSITION_RESOURCES: { id: string; label: { ar: string; en: string }; actions: MatrixAction[] }[] = [
  {
    "id": "accounts",
    "label": {
      "ar": "شجرة الحسابات",
      "en": "Accounts"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "costCenters",
    "label": {
      "ar": "مراكز التكلفة",
      "en": "Cost centers"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "departments",
    "label": {
      "ar": "الأقسام",
      "en": "Departments"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "branches",
    "label": {
      "ar": "الفروع",
      "en": "Branches"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "companyBankAccounts",
    "label": {
      "ar": "الحسابات البنكية",
      "en": "Company bank accounts"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "journalEntries",
    "label": {
      "ar": "القيود اليومية",
      "en": "Journal entries"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete",
      "approve"
    ]
  },
  {
    "id": "reports",
    "label": {
      "ar": "التقارير المالية",
      "en": "Reports"
    },
    "actions": [
      "read",
      "edit"
    ]
  },
  {
    "id": "customers",
    "label": {
      "ar": "العملاء",
      "en": "Customers"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "quotations",
    "label": {
      "ar": "عروض الأسعار",
      "en": "Quotations"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "salesInvoices",
    "label": {
      "ar": "فواتير المبيعات",
      "en": "Sales invoices"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete",
      "approve"
    ]
  },
  {
    "id": "salesReturns",
    "label": {
      "ar": "الإشعارات الدائنة",
      "en": "Sales returns"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete",
      "approve"
    ]
  },
  {
    "id": "salesDebitNotes",
    "label": {
      "ar": "الإشعارات المدينة",
      "en": "Sales debit notes"
    },
    "actions": [
      "read",
      "create",
      "delete",
      "approve"
    ]
  },
  {
    "id": "receipts",
    "label": {
      "ar": "سندات القبض",
      "en": "Receipts"
    },
    "actions": [
      "read",
      "create",
      "delete",
      "approve"
    ]
  },
  {
    "id": "stationSales",
    "label": {
      "ar": "مبيعات المحطات",
      "en": "Station sales"
    },
    "actions": [
      "read",
      "create",
      "delete"
    ]
  },
  {
    "id": "stationShiftsReports",
    "label": {
      "ar": "تقارير الورديات",
      "en": "Station shifts reports"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "salesReports",
    "label": {
      "ar": "تقارير المبيعات",
      "en": "Sales reports"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "suppliers",
    "label": {
      "ar": "الموردون",
      "en": "Suppliers"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "purchaseInvoices",
    "label": {
      "ar": "فواتير المشتريات",
      "en": "Purchase invoices"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete",
      "approve"
    ]
  },
  {
    "id": "purchaseReturns",
    "label": {
      "ar": "مردودات المشتريات",
      "en": "Purchase returns"
    },
    "actions": [
      "read",
      "create",
      "delete",
      "approve"
    ]
  },
  {
    "id": "purchaseReports",
    "label": {
      "ar": "تقارير المشتريات",
      "en": "Purchase reports"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "vatReconciliation",
    "label": {
      "ar": "مطابقة الضريبة",
      "en": "Vat reconciliation"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "items",
    "label": {
      "ar": "الأصناف",
      "en": "Items"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "warehouses",
    "label": {
      "ar": "المستودعات",
      "en": "Warehouses"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "stockMovements",
    "label": {
      "ar": "حركات المخزون",
      "en": "Stock movements"
    },
    "actions": [
      "read",
      "create",
      "delete",
      "approve"
    ]
  },
  {
    "id": "periodicSettlement",
    "label": {
      "ar": "الجرد الدوري",
      "en": "Periodic settlement"
    },
    "actions": [
      "read",
      "create",
      "approve"
    ]
  },
  {
    "id": "inventoryReports",
    "label": {
      "ar": "تقارير المخزون",
      "en": "Inventory reports"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "fixedAssets",
    "label": {
      "ar": "الأصول الثابتة",
      "en": "Fixed assets"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete",
      "approve"
    ]
  },
  {
    "id": "assetCategories",
    "label": {
      "ar": "تصنيفات الأصول",
      "en": "Asset categories"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "depreciation",
    "label": {
      "ar": "الإهلاك",
      "en": "Depreciation"
    },
    "actions": [
      "read",
      "create",
      "delete",
      "approve"
    ]
  },
  {
    "id": "employees",
    "label": {
      "ar": "الموظفون",
      "en": "Employees"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "hrActions",
    "label": {
      "ar": "إجراءات الموظفين",
      "en": "Hr actions"
    },
    "actions": [
      "read",
      "create",
      "delete"
    ]
  },
  {
    "id": "payrollRuns",
    "label": {
      "ar": "مسيرات الرواتب",
      "en": "Payroll runs"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete",
      "approve"
    ]
  },
  {
    "id": "employeeAdvances",
    "label": {
      "ar": "سلف الموظفين",
      "en": "Employee advances"
    },
    "actions": [
      "read",
      "create",
      "delete",
      "approve"
    ]
  },
  {
    "id": "leaveSettlements",
    "label": {
      "ar": "تسويات الإجازات",
      "en": "Leave settlements"
    },
    "actions": [
      "read",
      "create",
      "approve"
    ]
  },
  {
    "id": "leaveReturns",
    "label": {
      "ar": "العودة من الإجازة",
      "en": "Leave returns"
    },
    "actions": [
      "create"
    ]
  },
  {
    "id": "hrReports",
    "label": {
      "ar": "تقارير الموظفين",
      "en": "Hr reports"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "leaseContracts",
    "label": {
      "ar": "عقود الإيجار",
      "en": "Lease contracts"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "companyDocuments",
    "label": {
      "ar": "وثائق الشركة",
      "en": "Company documents"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "dashboard",
    "label": {
      "ar": "لوحة القيادة",
      "en": "Dashboard"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "stationSetup",
    "label": {
      "ar": "إعداد المحطات",
      "en": "Station setup"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "attendance",
    "label": {
      "ar": "الحضور والانصراف",
      "en": "Attendance"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "pos",
    "label": {
      "ar": "نقاط البيع",
      "en": "Pos"
    },
    "actions": [
      "read",
      "create",
      "approve"
    ]
  },
  {
    "id": "stables",
    "label": {
      "ar": "الإسطبلات",
      "en": "Stables"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "payrollSettings",
    "label": {
      "ar": "إعدادات وبنود الرواتب",
      "en": "Payroll settings"
    },
    "actions": [
      "read",
      "delete",
      "create",
      "edit"
    ]
  },
  {
    "id": "reportSchedules",
    "label": {
      "ar": "جدولة التقارير",
      "en": "Report schedules"
    },
    "actions": [
      "read",
      "edit"
    ]
  },
  {
    "id": "documentNumberingSettings",
    "label": {
      "ar": "ترقيم المستندات",
      "en": "Document numbering settings"
    },
    "actions": [
      "read",
      "edit"
    ]
  },
  {
    "id": "companiesZatca",
    "label": {
      "ar": "إعداد ربط زاتكا",
      "en": "Companies zatca"
    },
    "actions": [
      "read",
      "delete",
      "edit"
    ]
  },
  {
    "id": "attachments",
    "label": {
      "ar": "المرفقات",
      "en": "Attachments"
    },
    "actions": [
      "read",
      "delete",
      "create"
    ]
  },
  {
    "id": "ai",
    "label": {
      "ar": "المساعد الذكي",
      "en": "Ai"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "userAdministration",
    "label": {
      "ar": "إدارة المستخدمين والمنشأة",
      "en": "User and tenant administration"
    },
    "actions": [
      "read",
      "create",
      "edit",
      "delete"
    ]
  },
  {
    "id": "hrSensitiveData",
    "label": {
      "ar": "البيانات الشخصية والرواتب في التقارير والمرفقات",
      "en": "Personal and payroll data in reports and attachments"
    },
    "actions": [
      "read"
    ]
  },
  {
    "id": "companySettings",
    "label": {
      "ar": "إدارة الشركات",
      "en": "Company administration"
    },
    "actions": [
      "create",
      "edit",
      "approve"
    ]
  }
];
