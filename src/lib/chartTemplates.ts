import type { DefaultChartAccount } from "./defaultChartOfAccounts";

/**
 * قوالب شجرة الحسابات الخاصة بكل نشاط تجاري، مبنية من ملفات CSV التي زوّدنا بها المستخدم
 * (reference/*.csv)، بنفس هيكل 8 التصنيفات الرئيسية ونظام الترقيم 1-2-3-4 المستخدم في
 * DEFAULT_CHART_OF_ACCOUNTS. تُستخدم عند إنشاء شركة جديدة بدلاً من القالب الافتراضي عند اختيار
 * حقل "نشاط المنشأة"، وتبقى نقطة انطلاق فقط — يمكن للشركة تعديل/حذف/إضافة أي حساب بعدها بحرية.
 */
export const BUSINESS_ACTIVITIES = [
  "contracting",
  "manufacturing",
  "retail",
  "general_trade",
  "fuel_stations",
] as const;

export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[number];

export const CHART_TEMPLATE_BY_ACTIVITY: Record<BusinessActivity, DefaultChartAccount[]> = {
  contracting: [
{
  "code": "1",
  "name": "الأصول",
  "nameEn": "Assets",
  "type": "asset",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "11",
  "name": "الأصول المتداولة",
  "nameEn": "Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "111",
  "name": "النقدية وما في حكمها",
  "nameEn": "Cash and Cash Equivalents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1111",
  "name": "الصندوق النقدي - الإدارة العامة",
  "nameEn": "Cash on Hand - Head Office",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1112",
  "name": "صندوق نثرية الفروع/المواقع",
  "nameEn": "Petty Cash - Branches/Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1113",
  "name": "بنك - حساب جاري (1)",
  "nameEn": "Bank - Current Account (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1114",
  "name": "بنك - حساب جاري (2)",
  "nameEn": "Bank - Current Account (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1115",
  "name": "ودائع بنكية قصيرة الأجل",
  "nameEn": "Short-Term Bank Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "112",
  "name": "الذمم المدينة التجارية",
  "nameEn": "Trade Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1121",
  "name": "عملاء - مبيعات جملة/عقود",
  "nameEn": "Customers - Wholesale/Contract Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1122",
  "name": "عملاء - مبيعات نقدية/تجزئة",
  "nameEn": "Customers - Cash/Retail Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1123",
  "name": "أوراق قبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1124",
  "name": "عملاء - أطراف ذات علاقة",
  "nameEn": "Customers - Related Parties",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1125",
  "name": "مخصص ديون مشكوك في تحصيلها (عكسي)",
  "nameEn": "Allowance for Doubtful Debts (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1126",
  "name": "ذمم محتجزة لدى العملاء (Retention Receivable)",
  "nameEn": "Retention Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1127",
  "name": "مستخلصات تحت التحصيل",
  "nameEn": "Progress Billings Under Collection",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113",
  "name": "ذمم مدينة أخرى",
  "nameEn": "Other Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1131",
  "name": "دفعات مقدمة لموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1132",
  "name": "سلف وقروض الموظفين",
  "nameEn": "Employee Advances and Loans",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1133",
  "name": "ضريبة القيمة المضافة - مدينة (مشتريات)",
  "nameEn": "VAT Receivable (Purchases)",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1134",
  "name": "تأمينات وودائع قابلة للاسترداد",
  "nameEn": "Refundable Deposits and Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1135",
  "name": "عهد نقدية للمواقع والمهندسين",
  "nameEn": "Cash Custody - Sites and Engineers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "114",
  "name": "المخزون",
  "nameEn": "Inventory",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1141",
  "name": "مخزون مواد بناء بالمستودع الرئيسي",
  "nameEn": "Construction Materials Inventory - Main Warehouse",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1142",
  "name": "مخزون مواد بالمواقع (المشاريع)",
  "nameEn": "Materials Inventory - Project Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1143",
  "name": "مخزون أدوات ومهمات صغيرة",
  "nameEn": "Small Tools and Equipment Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115",
  "name": "مصروفات مدفوعة مقدماً",
  "nameEn": "Prepaid Expenses",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1151",
  "name": "إيجارات مدفوعة مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1152",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1153",
  "name": "اشتراكات ورخص مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions and Licenses",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "116",
  "name": "أعمال تحت التنفيذ ومستحقات عقود",
  "nameEn": "Work in Progress and Contract Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1161",
  "name": "أعمال تحت التنفيذ (WIP) - تكاليف متجمعة",
  "nameEn": "Work in Progress - Accumulated Costs",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1162",
  "name": "أصول عقود (إيرادات مستحقة زائدة عن المفوتر)",
  "nameEn": "Contract Assets (Revenue in Excess of Billings)",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "12",
  "name": "الأصول غير المتداولة",
  "nameEn": "Non-Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "121",
  "name": "الممتلكات والآلات والمعدات",
  "nameEn": "Property, Plant and Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1211",
  "name": "أراضٍ",
  "nameEn": "Land",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1212",
  "name": "مباني ومنشآت",
  "nameEn": "Buildings and Structures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1213",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1214",
  "name": "سيارات ووسائل نقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1215",
  "name": "أثاث وتجهيزات مكتبية",
  "nameEn": "Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1216",
  "name": "أجهزة حاسب آلي",
  "nameEn": "Computer Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1217",
  "name": "تحسينات على مأجور",
  "nameEn": "Leasehold Improvements",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1219",
  "name": "معدات ورافعات ثقيلة",
  "nameEn": "Heavy Equipment and Cranes",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1218",
  "name": "مجمع الإهلاك (عكسي)",
  "nameEn": "Accumulated Depreciation (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122",
  "name": "أصول غير ملموسة",
  "nameEn": "Intangible Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1221",
  "name": "برامج وأنظمة",
  "nameEn": "Software and Systems",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1222",
  "name": "شهرة المحل",
  "nameEn": "Goodwill",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1223",
  "name": "تراخيص وامتيازات تجارية",
  "nameEn": "Commercial Licenses and Franchises",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1224",
  "name": "مجمع الاستهلاك (عكسي)",
  "nameEn": "Accumulated Amortization (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "123",
  "name": "استثمارات وأصول أخرى غير متداولة",
  "nameEn": "Investments and Other Non-Current Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1231",
  "name": "استثمارات طويلة الأجل",
  "nameEn": "Long-Term Investments",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1232",
  "name": "تأمينات مستردة طويلة الأجل",
  "nameEn": "Long-Term Refundable Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1233",
  "name": "حق استخدام أصول مستأجرة (IFRS16)",
  "nameEn": "Right-of-Use Assets (IFRS16)",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2",
  "name": "الالتزامات",
  "nameEn": "Liabilities",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "21",
  "name": "الالتزامات المتداولة",
  "nameEn": "Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "211",
  "name": "الذمم الدائنة التجارية",
  "nameEn": "Trade Payables",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2111",
  "name": "موردون - محليون",
  "nameEn": "Suppliers - Local",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2112",
  "name": "موردون - مستوردون",
  "nameEn": "Suppliers - Importers",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2113",
  "name": "أوراق دفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2114",
  "name": "موردون - أطراف ذات علاقة",
  "nameEn": "Suppliers - Related Parties",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2115",
  "name": "ذمم مقاولي الباطن",
  "nameEn": "Subcontractors Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212",
  "name": "مصروفات مستحقة",
  "nameEn": "Accrued Expenses",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2121",
  "name": "رواتب مستحقة",
  "nameEn": "Accrued Salaries",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2122",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2123",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2124",
  "name": "مكافأة نهاية الخدمة - الجزء المتداول",
  "nameEn": "End of Service Benefits - Current Portion",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213",
  "name": "التزامات ضريبية وزكوية",
  "nameEn": "Tax and Zakat Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2131",
  "name": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "nameEn": "VAT Payable (Sales)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2132",
  "name": "الزكاة المستحقة",
  "nameEn": "Zakat Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2133",
  "name": "ضريبة الاستقطاع",
  "nameEn": "Withholding Tax",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "214",
  "name": "قروض قصيرة الأجل",
  "nameEn": "Short-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2141",
  "name": "قرض بنكي قصير الأجل",
  "nameEn": "Short-Term Bank Loan",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2142",
  "name": "الجزء المتداول من القروض طويلة الأجل",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "215",
  "name": "دفعات مقدمة ومستحقات عقود",
  "nameEn": "Advances and Contract Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2151",
  "name": "دفعات مقدمة من عملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2152",
  "name": "دفعات مقدمة (Advance Payment) على المشاريع",
  "nameEn": "Project Advance Payments",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "216",
  "name": "ضمانات ومحتجزات ومطلوبات عقود",
  "nameEn": "Guarantees, Retentions and Contract Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2161",
  "name": "ذمم محتجزة للمقاولين (Retention Payable)",
  "nameEn": "Retention Payable to Contractors",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2162",
  "name": "التزامات عقود (مفوتر زائد عن الإيرادات المستحقة)",
  "nameEn": "Contract Liabilities (Billings in Excess of Revenue)",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2163",
  "name": "مخصص ضمان الصيانة بعد التسليم",
  "nameEn": "Provision for Post-Delivery Maintenance Warranty",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2164",
  "name": "ضمانات ابتدائية ونهائية مستلمة",
  "nameEn": "Initial and Final Guarantees Received",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "22",
  "name": "الالتزامات غير المتداولة",
  "nameEn": "Non-Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "221",
  "name": "قروض طويلة الأجل",
  "nameEn": "Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2211",
  "name": "قروض بنكية طويلة الأجل",
  "nameEn": "Long-Term Bank Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "221",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "222",
  "name": "مخصص مكافأة نهاية الخدمة",
  "nameEn": "End of Service Benefits Provision",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2221",
  "name": "مخصص نهاية الخدمة - طويل الأجل",
  "nameEn": "End of Service Provision - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "222",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "223",
  "name": "التزامات عقود الإيجار (IFRS16)",
  "nameEn": "Lease Liabilities (IFRS16)",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2231",
  "name": "التزام عقد إيجار - طويل الأجل",
  "nameEn": "Lease Liability - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "223",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3",
  "name": "حقوق الملكية",
  "nameEn": "Equity",
  "type": "equity",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "31",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "311",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3111",
  "name": "رأس المال المدفوع",
  "nameEn": "Paid-up Capital",
  "type": "equity",
  "level": 4,
  "parentCode": "311",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "32",
  "name": "الاحتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "321",
  "name": "احتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 3,
  "parentCode": "32",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3211",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3212",
  "name": "احتياطي عام",
  "nameEn": "General Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "33",
  "name": "الأرباح المرحلة",
  "nameEn": "Retained Earnings",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "331",
  "name": "الأرباح والخسائر المتراكمة",
  "nameEn": "Accumulated Retained Earnings",
  "type": "equity",
  "level": 3,
  "parentCode": "33",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3311",
  "name": "أرباح مرحلة من سنوات سابقة",
  "nameEn": "Retained Earnings from Prior Years",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3312",
  "name": "صافي ربح / خسارة العام الحالي",
  "nameEn": "Net Income / Loss for the Current Year",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3313",
  "name": "توزيعات أرباح (عكسي)",
  "nameEn": "Dividends (Contra)",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "34",
  "name": "حساب الشركاء الجاري",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "341",
  "name": "الحساب الجاري للشركاء",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 3,
  "parentCode": "34",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3411",
  "name": "جاري الشركاء / المساهمين",
  "nameEn": "Partners' / Shareholders' Current Account",
  "type": "equity",
  "level": 4,
  "parentCode": "341",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4",
  "name": "الإيرادات",
  "nameEn": "Revenue",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "41",
  "name": "إيرادات النشاط الرئيسي",
  "nameEn": "Core Business Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "411",
  "name": "إيرادات النشاط",
  "nameEn": "Operating Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4111",
  "name": "إيرادات عقود مقاولات (حسب نسبة الإنجاز)",
  "nameEn": "Contracting Revenue (Percentage of Completion)",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4112",
  "name": "إيرادات أعمال إضافية / أوامر تغيير (Variation Orders)",
  "nameEn": "Variation Order Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4113",
  "name": "إيرادات مقاولات من الباطن لصالح الغير",
  "nameEn": "Subcontracting Revenue for Third Parties",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4114",
  "name": "إيرادات صيانة وضمان ما بعد التسليم",
  "nameEn": "Post-Delivery Maintenance and Warranty Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "42",
  "name": "مردودات ومسموحات المبيعات",
  "nameEn": "Sales Returns and Allowances",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "421",
  "name": "مردودات مبيعات",
  "nameEn": "Sales Returns",
  "type": "revenue",
  "level": 3,
  "parentCode": "42",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4211",
  "name": "مردودات وخصومات على مستخلصات (عكسي)",
  "nameEn": "Returns and Allowances on Progress Billings (Contra)",
  "type": "revenue",
  "level": 4,
  "parentCode": "421",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "43",
  "name": "إيرادات أخرى",
  "nameEn": "Other Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "431",
  "name": "إيرادات متنوعة",
  "nameEn": "Miscellaneous Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "43",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4311",
  "name": "إيراد بيع خردة / أصول",
  "nameEn": "Gain on Sale of Scrap / Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4312",
  "name": "إيرادات متنوعة أخرى",
  "nameEn": "Other Miscellaneous Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "51",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "511",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5111",
  "name": "تكلفة مواد البناء المستهلكة بالمشاريع",
  "nameEn": "Construction Materials Consumed on Projects",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5112",
  "name": "أجور عمالة الموقع المباشرة",
  "nameEn": "Direct Site Labor Costs",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5113",
  "name": "تكلفة مقاولي الباطن",
  "nameEn": "Subcontractor Costs",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5114",
  "name": "إيجار معدات ورافعات للمشاريع",
  "nameEn": "Equipment and Crane Rental for Projects",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5115",
  "name": "إهلاك معدات محمّل على المشاريع",
  "nameEn": "Equipment Depreciation Charged to Projects",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5116",
  "name": "تصاريح ورسوم مواقع العمل",
  "nameEn": "Site Permits and Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6",
  "name": "المصروفات التشغيلية",
  "nameEn": "Operating Expenses",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "61",
  "name": "الرواتب والأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "611",
  "name": "رواتب وأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 3,
  "parentCode": "61",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6111",
  "name": "رواتب الموظفين - الإدارة العامة",
  "nameEn": "Employee Salaries - Head Office",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6112",
  "name": "رواتب موظفي الميدان/الموقع",
  "nameEn": "Field/Site Staff Salaries",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6113",
  "name": "بدلات ومكافآت",
  "nameEn": "Allowances and Bonuses",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6114",
  "name": "التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6115",
  "name": "التأمين الطبي",
  "nameEn": "Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6116",
  "name": "مكافأة نهاية الخدمة (مصروف الفترة)",
  "nameEn": "End of Service Benefits Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "62",
  "name": "المصروفات الإدارية والعمومية",
  "nameEn": "General and Administrative Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "621",
  "name": "إيجارات ومصروفات إدارية",
  "nameEn": "Rent and Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6211",
  "name": "إيجار المقر الرئيسي",
  "nameEn": "Head Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6212",
  "name": "إيجار مواقع/فروع",
  "nameEn": "Site/Branch Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622",
  "name": "مصروفات إدارية عامة أخرى",
  "nameEn": "Other General Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6221",
  "name": "قرطاسية ومطبوعات",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6222",
  "name": "اتصالات وإنترنت",
  "nameEn": "Telecommunications and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6223",
  "name": "صيانة أجهزة وبرامج",
  "nameEn": "Hardware and Software Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "623",
  "name": "أتعاب ورسوم",
  "nameEn": "Professional Fees",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6231",
  "name": "أتعاب محاسبة ومراجعة",
  "nameEn": "Accounting and Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6232",
  "name": "أتعاب استشارات قانونية",
  "nameEn": "Legal Consulting Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "624",
  "name": "رسوم ورخص حكومية",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6241",
  "name": "رسوم حكومية وتراخيص",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 4,
  "parentCode": "624",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "63",
  "name": "مصروفات البيع والتسويق",
  "nameEn": "Selling and Marketing Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "631",
  "name": "دعاية وإعلان",
  "nameEn": "Advertising and Promotion",
  "type": "expense",
  "level": 3,
  "parentCode": "63",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6311",
  "name": "حملات تسويقية وإعلانية",
  "nameEn": "Marketing and Advertising Campaigns",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6312",
  "name": "عمولات مبيعات",
  "nameEn": "Sales Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "64",
  "name": "مصروفات الصيانة والمرافق",
  "nameEn": "Maintenance and Utilities Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "641",
  "name": "صيانة ومرافق",
  "nameEn": "Maintenance and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6411",
  "name": "صيانة دورية للمعدات/المنشآت",
  "nameEn": "Periodic Maintenance of Equipment/Facilities",
  "type": "expense",
  "level": 4,
  "parentCode": "641",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "642",
  "name": "المرافق العامة",
  "nameEn": "Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6421",
  "name": "كهرباء ومياه",
  "nameEn": "Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "642",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "65",
  "name": "الإهلاك والاستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "651",
  "name": "إهلاك واستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6511",
  "name": "إهلاك الممتلكات والمعدات",
  "nameEn": "Depreciation of Property and Equipment",
  "type": "expense",
  "level": 4,
  "parentCode": "651",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "652",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6521",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "652",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "66",
  "name": "مصروفات أخرى تشغيلية",
  "nameEn": "Other Operating Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "661",
  "name": "تأمين ومخصصات",
  "nameEn": "Insurance and Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6611",
  "name": "تأمين",
  "nameEn": "Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "661",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "662",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6621",
  "name": "مخصص ديون مشكوك فيها (مصروف الفترة)",
  "nameEn": "Doubtful Debts Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6622",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "7",
  "name": "إيرادات ومصروفات أخرى",
  "nameEn": "Other Income and Expenses",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "71",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "711",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 3,
  "parentCode": "71",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7111",
  "name": "إيراد فوائد ودائع بنكية",
  "nameEn": "Bank Deposit Interest Income",
  "type": "revenue",
  "level": 4,
  "parentCode": "711",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "72",
  "name": "التكاليف التمويلية",
  "nameEn": "Financing Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "721",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "revenue",
  "level": 3,
  "parentCode": "72",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7211",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "721",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "73",
  "name": "أرباح وخسائر غير تشغيلية",
  "nameEn": "Non-Operating Gains and Losses",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "731",
  "name": "أرباح/خسائر استبعاد أصول وفروق عملة",
  "nameEn": "Gains/Losses on Asset Disposal and FX Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "73",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7311",
  "name": "أرباح/خسائر بيع أصول ثابتة",
  "nameEn": "Gain/Loss on Sale of Fixed Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "731",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "74",
  "name": "فروقات العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "741",
  "name": "فروقات صرف العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "74",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7411",
  "name": "فروقات صرف عملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 4,
  "parentCode": "741",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8",
  "name": "حسابات ختامية ورقابية",
  "nameEn": "Closing and Control Accounts",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "81",
  "name": "حساب الأرباح والخسائر",
  "nameEn": "Profit and Loss Account",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "811",
  "name": "ملخص الدخل",
  "nameEn": "Income Summary",
  "type": "liability",
  "level": 3,
  "parentCode": "81",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8111",
  "name": "حساب الأرباح والخسائر (إقفال)",
  "nameEn": "Profit and Loss Account (Closing)",
  "type": "equity",
  "level": 4,
  "parentCode": "811",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "82",
  "name": "حسابات نظامية (تحت الرقابة)",
  "nameEn": "Statutory Control Accounts",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "821",
  "name": "التزامات محتملة وضمانات",
  "nameEn": "Contingent Liabilities and Guarantees",
  "type": "liability",
  "level": 3,
  "parentCode": "82",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8211",
  "name": "ضمانات بنكية صادرة",
  "nameEn": "Bank Guarantees Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8212",
  "name": "التزامات محتملة (Contingent Liabilities)",
  "nameEn": "Contingent Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2130",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6220",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1210",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5110",
  "name": "فروقات وهبوط مخزون",
  "nameEn": "Inventory Adjustments and Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
}
  ],
  manufacturing: [
{
  "code": "1",
  "name": "الأصول",
  "nameEn": "Assets",
  "type": "asset",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "11",
  "name": "الأصول المتداولة",
  "nameEn": "Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "111",
  "name": "النقدية وما في حكمها",
  "nameEn": "Cash and Cash Equivalents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1111",
  "name": "الصندوق النقدي - الإدارة العامة",
  "nameEn": "Cash on Hand - Head Office",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1112",
  "name": "صندوق نثرية الفروع/المواقع",
  "nameEn": "Petty Cash - Branches/Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1113",
  "name": "بنك - حساب جاري (1)",
  "nameEn": "Bank - Current Account (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1114",
  "name": "بنك - حساب جاري (2)",
  "nameEn": "Bank - Current Account (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1115",
  "name": "ودائع بنكية قصيرة الأجل",
  "nameEn": "Short-Term Bank Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "112",
  "name": "الذمم المدينة التجارية",
  "nameEn": "Trade Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1121",
  "name": "عملاء - مبيعات جملة/عقود",
  "nameEn": "Customers - Wholesale/Contract Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1122",
  "name": "عملاء - مبيعات نقدية/تجزئة",
  "nameEn": "Customers - Cash/Retail Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1123",
  "name": "أوراق قبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1124",
  "name": "عملاء - أطراف ذات علاقة",
  "nameEn": "Customers - Related Parties",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1125",
  "name": "مخصص ديون مشكوك في تحصيلها (عكسي)",
  "nameEn": "Allowance for Doubtful Debts (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113",
  "name": "ذمم مدينة أخرى",
  "nameEn": "Other Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1131",
  "name": "دفعات مقدمة لموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1132",
  "name": "سلف وقروض الموظفين",
  "nameEn": "Employee Advances and Loans",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1133",
  "name": "ضريبة القيمة المضافة - مدينة (مشتريات)",
  "nameEn": "VAT Receivable (Purchases)",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1134",
  "name": "تأمينات وودائع قابلة للاسترداد",
  "nameEn": "Refundable Deposits and Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1135",
  "name": "عهد نقدية لأقسام الإنتاج والمشتريات",
  "nameEn": "Cash Custody - Production and Purchasing Departments",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "114",
  "name": "المخزون",
  "nameEn": "Inventory",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1141",
  "name": "مخزون مواد خام",
  "nameEn": "Raw Materials Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1142",
  "name": "مخزون مواد تعبئة وتغليف",
  "nameEn": "Packaging Materials Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1143",
  "name": "مخزون إنتاج تحت التشغيل (WIP)",
  "nameEn": "Work in Progress Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1144",
  "name": "مخزون بضاعة تامة الصنع",
  "nameEn": "Finished Goods Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1145",
  "name": "مخزون قطع غيار وصيانة الآلات",
  "nameEn": "Spare Parts and Machinery Maintenance Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1146",
  "name": "مخصص تلف وبطء حركة المخزون (عكسي)",
  "nameEn": "Provision for Inventory Damage and Slow Movement (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115",
  "name": "مصروفات مدفوعة مقدماً",
  "nameEn": "Prepaid Expenses",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1151",
  "name": "إيجارات مدفوعة مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1152",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1153",
  "name": "اشتراكات ورخص مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions and Licenses",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "116",
  "name": "بضاعة بالطريق ومستلزمات استيراد",
  "nameEn": "Goods in Transit and Import Requisites",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1161",
  "name": "بضاعة ومواد خام بالطريق",
  "nameEn": "Goods and Raw Materials in Transit",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1162",
  "name": "اعتمادات مستندية (LC) مفتوحة",
  "nameEn": "Open Letters of Credit (LC)",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "12",
  "name": "الأصول غير المتداولة",
  "nameEn": "Non-Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "121",
  "name": "الممتلكات والآلات والمعدات",
  "nameEn": "Property, Plant and Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1211",
  "name": "أراضٍ",
  "nameEn": "Land",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1212",
  "name": "مباني ومنشآت",
  "nameEn": "Buildings and Structures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1213",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1214",
  "name": "سيارات ووسائل نقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1215",
  "name": "أثاث وتجهيزات مكتبية",
  "nameEn": "Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1216",
  "name": "أجهزة حاسب آلي",
  "nameEn": "Computer Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1217",
  "name": "تحسينات على مأجور",
  "nameEn": "Leasehold Improvements",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1219",
  "name": "آلات ومعدات المصنع الثقيلة",
  "nameEn": "Heavy Factory Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1218",
  "name": "مجمع الإهلاك (عكسي)",
  "nameEn": "Accumulated Depreciation (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122",
  "name": "أصول غير ملموسة",
  "nameEn": "Intangible Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1221",
  "name": "برامج وأنظمة",
  "nameEn": "Software and Systems",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1222",
  "name": "شهرة المحل",
  "nameEn": "Goodwill",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1223",
  "name": "تراخيص وامتيازات تجارية",
  "nameEn": "Commercial Licenses and Franchises",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1224",
  "name": "مجمع الاستهلاك (عكسي)",
  "nameEn": "Accumulated Amortization (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "123",
  "name": "استثمارات وأصول أخرى غير متداولة",
  "nameEn": "Investments and Other Non-Current Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1231",
  "name": "استثمارات طويلة الأجل",
  "nameEn": "Long-Term Investments",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1232",
  "name": "تأمينات مستردة طويلة الأجل",
  "nameEn": "Long-Term Refundable Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1233",
  "name": "حق استخدام أصول مستأجرة (IFRS16)",
  "nameEn": "Right-of-Use Assets (IFRS16)",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2",
  "name": "الالتزامات",
  "nameEn": "Liabilities",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "21",
  "name": "الالتزامات المتداولة",
  "nameEn": "Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "211",
  "name": "الذمم الدائنة التجارية",
  "nameEn": "Trade Payables",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2111",
  "name": "موردون - محليون",
  "nameEn": "Suppliers - Local",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2112",
  "name": "موردون - مستوردون",
  "nameEn": "Suppliers - Importers",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2113",
  "name": "أوراق دفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2114",
  "name": "موردون - أطراف ذات علاقة",
  "nameEn": "Suppliers - Related Parties",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2115",
  "name": "موردو مواد خام - أجل",
  "nameEn": "Raw Material Suppliers - Credit",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212",
  "name": "مصروفات مستحقة",
  "nameEn": "Accrued Expenses",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2121",
  "name": "رواتب مستحقة",
  "nameEn": "Accrued Salaries",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2122",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2123",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2124",
  "name": "مكافأة نهاية الخدمة - الجزء المتداول",
  "nameEn": "End of Service Benefits - Current Portion",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213",
  "name": "التزامات ضريبية وزكوية",
  "nameEn": "Tax and Zakat Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2131",
  "name": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "nameEn": "VAT Payable (Sales)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2132",
  "name": "الزكاة المستحقة",
  "nameEn": "Zakat Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2133",
  "name": "ضريبة الاستقطاع",
  "nameEn": "Withholding Tax",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "214",
  "name": "قروض قصيرة الأجل",
  "nameEn": "Short-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2141",
  "name": "قرض بنكي قصير الأجل",
  "nameEn": "Short-Term Bank Loan",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2142",
  "name": "الجزء المتداول من القروض طويلة الأجل",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "215",
  "name": "دفعات مقدمة ومستحقات عقود",
  "nameEn": "Advances and Contract Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2151",
  "name": "دفعات مقدمة من عملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "216",
  "name": "رسوم ومستحقات استيراد",
  "nameEn": "Import Fees and Dues",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2161",
  "name": "رسوم جمركية مستحقة",
  "nameEn": "Accrued Customs Duties",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2162",
  "name": "اعتمادات مستندية دائنة",
  "nameEn": "Letters of Credit Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "22",
  "name": "الالتزامات غير المتداولة",
  "nameEn": "Non-Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "221",
  "name": "قروض طويلة الأجل",
  "nameEn": "Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2211",
  "name": "قروض بنكية طويلة الأجل",
  "nameEn": "Long-Term Bank Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "221",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "222",
  "name": "مخصص مكافأة نهاية الخدمة",
  "nameEn": "End of Service Benefits Provision",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2221",
  "name": "مخصص نهاية الخدمة - طويل الأجل",
  "nameEn": "End of Service Provision - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "222",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "223",
  "name": "التزامات عقود الإيجار (IFRS16)",
  "nameEn": "Lease Liabilities (IFRS16)",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2231",
  "name": "التزام عقد إيجار - طويل الأجل",
  "nameEn": "Lease Liability - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "223",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3",
  "name": "حقوق الملكية",
  "nameEn": "Equity",
  "type": "equity",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "31",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "311",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3111",
  "name": "رأس المال المدفوع",
  "nameEn": "Paid-up Capital",
  "type": "equity",
  "level": 4,
  "parentCode": "311",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "32",
  "name": "الاحتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "321",
  "name": "احتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 3,
  "parentCode": "32",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3211",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3212",
  "name": "احتياطي عام",
  "nameEn": "General Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "33",
  "name": "الأرباح المرحلة",
  "nameEn": "Retained Earnings",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "331",
  "name": "الأرباح والخسائر المتراكمة",
  "nameEn": "Accumulated Retained Earnings",
  "type": "equity",
  "level": 3,
  "parentCode": "33",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3311",
  "name": "أرباح مرحلة من سنوات سابقة",
  "nameEn": "Retained Earnings from Prior Years",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3312",
  "name": "صافي ربح / خسارة العام الحالي",
  "nameEn": "Net Income / Loss for the Current Year",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3313",
  "name": "توزيعات أرباح (عكسي)",
  "nameEn": "Dividends (Contra)",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "34",
  "name": "حساب الشركاء الجاري",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "341",
  "name": "الحساب الجاري للشركاء",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 3,
  "parentCode": "34",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3411",
  "name": "جاري الشركاء / المساهمين",
  "nameEn": "Partners' / Shareholders' Current Account",
  "type": "equity",
  "level": 4,
  "parentCode": "341",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4",
  "name": "الإيرادات",
  "nameEn": "Revenue",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "41",
  "name": "إيرادات النشاط الرئيسي",
  "nameEn": "Core Business Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "411",
  "name": "إيرادات النشاط",
  "nameEn": "Operating Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4111",
  "name": "إيرادات مبيعات محلية",
  "nameEn": "Local Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4112",
  "name": "إيرادات مبيعات تصدير",
  "nameEn": "Export Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4113",
  "name": "إيرادات تصنيع لدى الغير (Tolling)",
  "nameEn": "Toll Manufacturing Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4114",
  "name": "إيرادات بيع مخلفات ومخردات الإنتاج",
  "nameEn": "Revenue from Sale of Production Scrap and Waste",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "42",
  "name": "مردودات ومسموحات المبيعات",
  "nameEn": "Sales Returns and Allowances",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "421",
  "name": "مردودات مبيعات",
  "nameEn": "Sales Returns",
  "type": "revenue",
  "level": 3,
  "parentCode": "42",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4211",
  "name": "مردودات وخصم مسموح به (عكسي)",
  "nameEn": "Returns and Allowances (Contra)",
  "type": "revenue",
  "level": 4,
  "parentCode": "421",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "43",
  "name": "إيرادات أخرى",
  "nameEn": "Other Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "431",
  "name": "إيرادات متنوعة",
  "nameEn": "Miscellaneous Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "43",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4311",
  "name": "إيراد بيع خردة / أصول",
  "nameEn": "Gain on Sale of Scrap / Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4312",
  "name": "إيرادات متنوعة أخرى",
  "nameEn": "Other Miscellaneous Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "51",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "511",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5111",
  "name": "مواد خام مستهلكة في الإنتاج",
  "nameEn": "Raw Materials Consumed in Production",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5112",
  "name": "أجور عمالة مباشرة",
  "nameEn": "Direct Labor Costs",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5113",
  "name": "أعباء صناعية غير مباشرة (طاقة ومحروقات المصنع)",
  "nameEn": "Manufacturing Overhead (Factory Energy and Fuel)",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5114",
  "name": "إهلاك آلات ومعدات الإنتاج",
  "nameEn": "Depreciation of Production Machinery and Equipment",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5115",
  "name": "صيانة خطوط الإنتاج",
  "nameEn": "Production Line Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5116",
  "name": "إشراف ورقابة جودة الإنتاج",
  "nameEn": "Production Supervision and Quality Control",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5117",
  "name": "انحراف التكاليف المعيارية (Variance)",
  "nameEn": "Standard Cost Variance",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6",
  "name": "المصروفات التشغيلية",
  "nameEn": "Operating Expenses",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "61",
  "name": "الرواتب والأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "611",
  "name": "رواتب وأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 3,
  "parentCode": "61",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6111",
  "name": "رواتب الموظفين - الإدارة العامة",
  "nameEn": "Employee Salaries - Head Office",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6112",
  "name": "رواتب موظفي الميدان/الموقع",
  "nameEn": "Field/Site Staff Salaries",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6113",
  "name": "بدلات ومكافآت",
  "nameEn": "Allowances and Bonuses",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6114",
  "name": "التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6115",
  "name": "التأمين الطبي",
  "nameEn": "Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6116",
  "name": "مكافأة نهاية الخدمة (مصروف الفترة)",
  "nameEn": "End of Service Benefits Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "62",
  "name": "المصروفات الإدارية والعمومية",
  "nameEn": "General and Administrative Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "621",
  "name": "إيجارات ومصروفات إدارية",
  "nameEn": "Rent and Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6211",
  "name": "إيجار المقر الرئيسي",
  "nameEn": "Head Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6212",
  "name": "إيجار مواقع/فروع",
  "nameEn": "Site/Branch Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622",
  "name": "مصروفات إدارية عامة أخرى",
  "nameEn": "Other General Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6221",
  "name": "قرطاسية ومطبوعات",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6222",
  "name": "اتصالات وإنترنت",
  "nameEn": "Telecommunications and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6223",
  "name": "صيانة أجهزة وبرامج",
  "nameEn": "Hardware and Software Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "623",
  "name": "أتعاب ورسوم",
  "nameEn": "Professional Fees",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6231",
  "name": "أتعاب محاسبة ومراجعة",
  "nameEn": "Accounting and Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6232",
  "name": "أتعاب استشارات قانونية",
  "nameEn": "Legal Consulting Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "624",
  "name": "رسوم ورخص حكومية",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6241",
  "name": "رسوم حكومية وتراخيص",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 4,
  "parentCode": "624",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "63",
  "name": "مصروفات البيع والتسويق",
  "nameEn": "Selling and Marketing Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "631",
  "name": "دعاية وإعلان",
  "nameEn": "Advertising and Promotion",
  "type": "expense",
  "level": 3,
  "parentCode": "63",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6311",
  "name": "حملات تسويقية وإعلانية",
  "nameEn": "Marketing and Advertising Campaigns",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6312",
  "name": "عمولات مبيعات",
  "nameEn": "Sales Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "64",
  "name": "مصروفات الصيانة والمرافق",
  "nameEn": "Maintenance and Utilities Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "641",
  "name": "صيانة ومرافق",
  "nameEn": "Maintenance and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6411",
  "name": "صيانة دورية للمعدات/المنشآت",
  "nameEn": "Periodic Maintenance of Equipment/Facilities",
  "type": "expense",
  "level": 4,
  "parentCode": "641",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "642",
  "name": "المرافق العامة",
  "nameEn": "Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6421",
  "name": "كهرباء ومياه",
  "nameEn": "Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "642",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "65",
  "name": "الإهلاك والاستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "651",
  "name": "إهلاك واستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6511",
  "name": "إهلاك الممتلكات والمعدات",
  "nameEn": "Depreciation of Property and Equipment",
  "type": "expense",
  "level": 4,
  "parentCode": "651",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "652",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6521",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "652",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "66",
  "name": "مصروفات أخرى تشغيلية",
  "nameEn": "Other Operating Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "661",
  "name": "تأمين ومخصصات",
  "nameEn": "Insurance and Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6611",
  "name": "تأمين",
  "nameEn": "Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "661",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "662",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6621",
  "name": "مخصص ديون مشكوك فيها (مصروف الفترة)",
  "nameEn": "Doubtful Debts Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6622",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "7",
  "name": "إيرادات ومصروفات أخرى",
  "nameEn": "Other Income and Expenses",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "71",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "711",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 3,
  "parentCode": "71",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7111",
  "name": "إيراد فوائد ودائع بنكية",
  "nameEn": "Bank Deposit Interest Income",
  "type": "revenue",
  "level": 4,
  "parentCode": "711",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "72",
  "name": "التكاليف التمويلية",
  "nameEn": "Financing Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "721",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "revenue",
  "level": 3,
  "parentCode": "72",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7211",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "721",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "73",
  "name": "أرباح وخسائر غير تشغيلية",
  "nameEn": "Non-Operating Gains and Losses",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "731",
  "name": "أرباح/خسائر استبعاد أصول وفروق عملة",
  "nameEn": "Gains/Losses on Asset Disposal and FX Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "73",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7311",
  "name": "أرباح/خسائر بيع أصول ثابتة",
  "nameEn": "Gain/Loss on Sale of Fixed Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "731",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "74",
  "name": "فروقات العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "741",
  "name": "فروقات صرف العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "74",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7411",
  "name": "فروقات صرف عملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 4,
  "parentCode": "741",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8",
  "name": "حسابات ختامية ورقابية",
  "nameEn": "Closing and Control Accounts",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "81",
  "name": "حساب الأرباح والخسائر",
  "nameEn": "Profit and Loss Account",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "811",
  "name": "ملخص الدخل",
  "nameEn": "Income Summary",
  "type": "liability",
  "level": 3,
  "parentCode": "81",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8111",
  "name": "حساب الأرباح والخسائر (إقفال)",
  "nameEn": "Profit and Loss Account (Closing)",
  "type": "equity",
  "level": 4,
  "parentCode": "811",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "82",
  "name": "حسابات نظامية (تحت الرقابة)",
  "nameEn": "Statutory Control Accounts",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "821",
  "name": "التزامات محتملة وضمانات",
  "nameEn": "Contingent Liabilities and Guarantees",
  "type": "liability",
  "level": 3,
  "parentCode": "82",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8211",
  "name": "ضمانات بنكية صادرة",
  "nameEn": "Bank Guarantees Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8212",
  "name": "التزامات محتملة (Contingent Liabilities)",
  "nameEn": "Contingent Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2130",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6220",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1210",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5110",
  "name": "فروقات وهبوط مخزون",
  "nameEn": "Inventory Adjustments and Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
}
  ],
  retail: [
{
  "code": "1",
  "name": "الأصول",
  "nameEn": "Assets",
  "type": "asset",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "11",
  "name": "الأصول المتداولة",
  "nameEn": "Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "111",
  "name": "النقدية وما في حكمها",
  "nameEn": "Cash and Cash Equivalents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1111",
  "name": "الصندوق النقدي - الإدارة العامة",
  "nameEn": "Cash on Hand - Head Office",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1112",
  "name": "صندوق نثرية الفروع/المواقع",
  "nameEn": "Petty Cash - Branches/Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1113",
  "name": "بنك - حساب جاري (1)",
  "nameEn": "Bank - Current Account (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1114",
  "name": "بنك - حساب جاري (2)",
  "nameEn": "Bank - Current Account (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1115",
  "name": "ودائع بنكية قصيرة الأجل",
  "nameEn": "Short-Term Bank Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "112",
  "name": "الذمم المدينة التجارية",
  "nameEn": "Trade Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1121",
  "name": "عملاء - مبيعات جملة/عقود",
  "nameEn": "Customers - Wholesale/Contract Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1122",
  "name": "عملاء - مبيعات نقدية/تجزئة",
  "nameEn": "Customers - Cash/Retail Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1123",
  "name": "أوراق قبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1124",
  "name": "عملاء - أطراف ذات علاقة",
  "nameEn": "Customers - Related Parties",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1125",
  "name": "مخصص ديون مشكوك في تحصيلها (عكسي)",
  "nameEn": "Allowance for Doubtful Debts (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113",
  "name": "ذمم مدينة أخرى",
  "nameEn": "Other Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1131",
  "name": "دفعات مقدمة لموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1132",
  "name": "سلف وقروض الموظفين",
  "nameEn": "Employee Advances and Loans",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1133",
  "name": "ضريبة القيمة المضافة - مدينة (مشتريات)",
  "nameEn": "VAT Receivable (Purchases)",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1134",
  "name": "تأمينات وودائع قابلة للاسترداد",
  "nameEn": "Refundable Deposits and Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1135",
  "name": "عهدة أمناء صناديق نقاط البيع (POS)",
  "nameEn": "POS Cashier Custody",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "114",
  "name": "المخزون",
  "nameEn": "Inventory",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1141",
  "name": "مخزون بضاعة جاهزة للبيع - فئة (1)",
  "nameEn": "Merchandise Inventory for Sale - Category (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1142",
  "name": "مخزون بضاعة جاهزة للبيع - فئة (2)",
  "nameEn": "Merchandise Inventory for Sale - Category (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1143",
  "name": "مخزون بضاعة بمخازن الفروع",
  "nameEn": "Merchandise Inventory - Branch Warehouses",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1144",
  "name": "مخزون عروض وهدايا ترويجية",
  "nameEn": "Promotional Offers and Gifts Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1145",
  "name": "مخصص عجز/تلف جرد المتاجر (عكسي)",
  "nameEn": "Provision for Store Inventory Shortage/Damage (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115",
  "name": "مصروفات مدفوعة مقدماً",
  "nameEn": "Prepaid Expenses",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1151",
  "name": "إيجارات مدفوعة مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1152",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1153",
  "name": "اشتراكات ورخص مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions and Licenses",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "116",
  "name": "مستحقات مبيعات الشبكة",
  "nameEn": "Card Network Sales Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1161",
  "name": "مستحقات شركات الدفع الإلكتروني/الشبكة",
  "nameEn": "Electronic Payment/Network Companies Receivables",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "12",
  "name": "الأصول غير المتداولة",
  "nameEn": "Non-Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "121",
  "name": "الممتلكات والآلات والمعدات",
  "nameEn": "Property, Plant and Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1211",
  "name": "أراضٍ",
  "nameEn": "Land",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1212",
  "name": "مباني ومنشآت",
  "nameEn": "Buildings and Structures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1213",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1214",
  "name": "سيارات ووسائل نقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1215",
  "name": "أثاث وتجهيزات مكتبية",
  "nameEn": "Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1216",
  "name": "أجهزة حاسب آلي",
  "nameEn": "Computer Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1217",
  "name": "تحسينات على مأجور",
  "nameEn": "Leasehold Improvements",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1219",
  "name": "معدات وواجهات عرض المتاجر",
  "nameEn": "Store Display Equipment and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1218",
  "name": "مجمع الإهلاك (عكسي)",
  "nameEn": "Accumulated Depreciation (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122",
  "name": "أصول غير ملموسة",
  "nameEn": "Intangible Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1221",
  "name": "برامج وأنظمة",
  "nameEn": "Software and Systems",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1222",
  "name": "شهرة المحل",
  "nameEn": "Goodwill",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1223",
  "name": "تراخيص وامتيازات تجارية",
  "nameEn": "Commercial Licenses and Franchises",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1224",
  "name": "مجمع الاستهلاك (عكسي)",
  "nameEn": "Accumulated Amortization (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "123",
  "name": "استثمارات وأصول أخرى غير متداولة",
  "nameEn": "Investments and Other Non-Current Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1231",
  "name": "استثمارات طويلة الأجل",
  "nameEn": "Long-Term Investments",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1232",
  "name": "تأمينات مستردة طويلة الأجل",
  "nameEn": "Long-Term Refundable Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1233",
  "name": "حق استخدام أصول مستأجرة (IFRS16)",
  "nameEn": "Right-of-Use Assets (IFRS16)",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2",
  "name": "الالتزامات",
  "nameEn": "Liabilities",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "21",
  "name": "الالتزامات المتداولة",
  "nameEn": "Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "211",
  "name": "الذمم الدائنة التجارية",
  "nameEn": "Trade Payables",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2111",
  "name": "موردون - محليون",
  "nameEn": "Suppliers - Local",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2112",
  "name": "موردون - مستوردون",
  "nameEn": "Suppliers - Importers",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2113",
  "name": "أوراق دفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2114",
  "name": "موردون - أطراف ذات علاقة",
  "nameEn": "Suppliers - Related Parties",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212",
  "name": "مصروفات مستحقة",
  "nameEn": "Accrued Expenses",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2121",
  "name": "رواتب مستحقة",
  "nameEn": "Accrued Salaries",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2122",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2123",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2124",
  "name": "مكافأة نهاية الخدمة - الجزء المتداول",
  "nameEn": "End of Service Benefits - Current Portion",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213",
  "name": "التزامات ضريبية وزكوية",
  "nameEn": "Tax and Zakat Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2131",
  "name": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "nameEn": "VAT Payable (Sales)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2132",
  "name": "الزكاة المستحقة",
  "nameEn": "Zakat Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2133",
  "name": "ضريبة الاستقطاع",
  "nameEn": "Withholding Tax",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "214",
  "name": "قروض قصيرة الأجل",
  "nameEn": "Short-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2141",
  "name": "قرض بنكي قصير الأجل",
  "nameEn": "Short-Term Bank Loan",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2142",
  "name": "الجزء المتداول من القروض طويلة الأجل",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "215",
  "name": "دفعات مقدمة ومستحقات عقود",
  "nameEn": "Advances and Contract Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2151",
  "name": "دفعات مقدمة من عملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "216",
  "name": "التزامات برامج العملاء",
  "nameEn": "Customer Program Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2161",
  "name": "بطاقات هدايا وقسائم شراء صادرة (Gift Cards)",
  "nameEn": "Gift Cards Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2162",
  "name": "التزامات برنامج نقاط الولاء",
  "nameEn": "Loyalty Points Program Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "22",
  "name": "الالتزامات غير المتداولة",
  "nameEn": "Non-Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "221",
  "name": "قروض طويلة الأجل",
  "nameEn": "Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2211",
  "name": "قروض بنكية طويلة الأجل",
  "nameEn": "Long-Term Bank Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "221",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "222",
  "name": "مخصص مكافأة نهاية الخدمة",
  "nameEn": "End of Service Benefits Provision",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2221",
  "name": "مخصص نهاية الخدمة - طويل الأجل",
  "nameEn": "End of Service Provision - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "222",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "223",
  "name": "التزامات عقود الإيجار (IFRS16)",
  "nameEn": "Lease Liabilities (IFRS16)",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2231",
  "name": "التزام عقد إيجار - طويل الأجل",
  "nameEn": "Lease Liability - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "223",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3",
  "name": "حقوق الملكية",
  "nameEn": "Equity",
  "type": "equity",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "31",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "311",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3111",
  "name": "رأس المال المدفوع",
  "nameEn": "Paid-up Capital",
  "type": "equity",
  "level": 4,
  "parentCode": "311",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "32",
  "name": "الاحتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "321",
  "name": "احتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 3,
  "parentCode": "32",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3211",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3212",
  "name": "احتياطي عام",
  "nameEn": "General Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "33",
  "name": "الأرباح المرحلة",
  "nameEn": "Retained Earnings",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "331",
  "name": "الأرباح والخسائر المتراكمة",
  "nameEn": "Accumulated Retained Earnings",
  "type": "equity",
  "level": 3,
  "parentCode": "33",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3311",
  "name": "أرباح مرحلة من سنوات سابقة",
  "nameEn": "Retained Earnings from Prior Years",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3312",
  "name": "صافي ربح / خسارة العام الحالي",
  "nameEn": "Net Income / Loss for the Current Year",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3313",
  "name": "توزيعات أرباح (عكسي)",
  "nameEn": "Dividends (Contra)",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "34",
  "name": "حساب الشركاء الجاري",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "341",
  "name": "الحساب الجاري للشركاء",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 3,
  "parentCode": "34",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3411",
  "name": "جاري الشركاء / المساهمين",
  "nameEn": "Partners' / Shareholders' Current Account",
  "type": "equity",
  "level": 4,
  "parentCode": "341",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4",
  "name": "الإيرادات",
  "nameEn": "Revenue",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "41",
  "name": "إيرادات النشاط الرئيسي",
  "nameEn": "Core Business Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "411",
  "name": "إيرادات النشاط",
  "nameEn": "Operating Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4111",
  "name": "إيرادات مبيعات نقدية بالمتاجر",
  "nameEn": "Cash Sales Revenue - Stores",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4112",
  "name": "إيرادات مبيعات بالشبكة (نقاط بيع/بطاقات)",
  "nameEn": "Network Sales Revenue (POS/Cards)",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4113",
  "name": "إيرادات مبيعات أونلاين",
  "nameEn": "Online Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4114",
  "name": "إيرادات تشغيل امتياز/فرنشايز فروع",
  "nameEn": "Franchise Operation Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "42",
  "name": "مردودات ومسموحات المبيعات",
  "nameEn": "Sales Returns and Allowances",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "421",
  "name": "مردودات مبيعات",
  "nameEn": "Sales Returns",
  "type": "revenue",
  "level": 3,
  "parentCode": "42",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4211",
  "name": "مردودات وإرجاع مبيعات من العملاء (عكسي)",
  "nameEn": "Sales Returns from Customers (Contra)",
  "type": "revenue",
  "level": 4,
  "parentCode": "421",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "43",
  "name": "إيرادات أخرى",
  "nameEn": "Other Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "431",
  "name": "إيرادات متنوعة",
  "nameEn": "Miscellaneous Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "43",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4311",
  "name": "إيراد بيع خردة / أصول",
  "nameEn": "Gain on Sale of Scrap / Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4312",
  "name": "إيرادات متنوعة أخرى",
  "nameEn": "Other Miscellaneous Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "51",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "511",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5111",
  "name": "تكلفة البضاعة المباعة",
  "nameEn": "Cost of Goods Sold",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5112",
  "name": "عجز/فائض جرد المتاجر (Shrinkage)",
  "nameEn": "Store Inventory Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5113",
  "name": "تكلفة الشحن والتوصيل للعملاء",
  "nameEn": "Shipping and Delivery Cost to Customers",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6",
  "name": "المصروفات التشغيلية",
  "nameEn": "Operating Expenses",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "61",
  "name": "الرواتب والأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "611",
  "name": "رواتب وأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 3,
  "parentCode": "61",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6111",
  "name": "رواتب الموظفين - الإدارة العامة",
  "nameEn": "Employee Salaries - Head Office",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6112",
  "name": "رواتب موظفي الميدان/الموقع",
  "nameEn": "Field/Site Staff Salaries",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6113",
  "name": "بدلات ومكافآت",
  "nameEn": "Allowances and Bonuses",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6114",
  "name": "التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6115",
  "name": "التأمين الطبي",
  "nameEn": "Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6116",
  "name": "مكافأة نهاية الخدمة (مصروف الفترة)",
  "nameEn": "End of Service Benefits Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "62",
  "name": "المصروفات الإدارية والعمومية",
  "nameEn": "General and Administrative Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "621",
  "name": "إيجارات ومصروفات إدارية",
  "nameEn": "Rent and Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6211",
  "name": "إيجار المقر الرئيسي",
  "nameEn": "Head Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6212",
  "name": "إيجار مواقع/فروع",
  "nameEn": "Site/Branch Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622",
  "name": "مصروفات إدارية عامة أخرى",
  "nameEn": "Other General Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6221",
  "name": "قرطاسية ومطبوعات",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6222",
  "name": "اتصالات وإنترنت",
  "nameEn": "Telecommunications and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6223",
  "name": "صيانة أجهزة وبرامج",
  "nameEn": "Hardware and Software Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "623",
  "name": "أتعاب ورسوم",
  "nameEn": "Professional Fees",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6231",
  "name": "أتعاب محاسبة ومراجعة",
  "nameEn": "Accounting and Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6232",
  "name": "أتعاب استشارات قانونية",
  "nameEn": "Legal Consulting Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "624",
  "name": "رسوم ورخص حكومية",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6241",
  "name": "رسوم حكومية وتراخيص",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 4,
  "parentCode": "624",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "63",
  "name": "مصروفات البيع والتسويق",
  "nameEn": "Selling and Marketing Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "631",
  "name": "دعاية وإعلان",
  "nameEn": "Advertising and Promotion",
  "type": "expense",
  "level": 3,
  "parentCode": "63",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6311",
  "name": "حملات تسويقية وإعلانية",
  "nameEn": "Marketing and Advertising Campaigns",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6312",
  "name": "عمولات مبيعات",
  "nameEn": "Sales Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "64",
  "name": "مصروفات الصيانة والمرافق",
  "nameEn": "Maintenance and Utilities Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "641",
  "name": "صيانة ومرافق",
  "nameEn": "Maintenance and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6411",
  "name": "صيانة دورية للمعدات/المنشآت",
  "nameEn": "Periodic Maintenance of Equipment/Facilities",
  "type": "expense",
  "level": 4,
  "parentCode": "641",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "642",
  "name": "المرافق العامة",
  "nameEn": "Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6421",
  "name": "كهرباء ومياه",
  "nameEn": "Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "642",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "65",
  "name": "الإهلاك والاستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "651",
  "name": "إهلاك واستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6511",
  "name": "إهلاك الممتلكات والمعدات",
  "nameEn": "Depreciation of Property and Equipment",
  "type": "expense",
  "level": 4,
  "parentCode": "651",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "652",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6521",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "652",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "66",
  "name": "مصروفات أخرى تشغيلية",
  "nameEn": "Other Operating Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "661",
  "name": "تأمين ومخصصات",
  "nameEn": "Insurance and Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6611",
  "name": "تأمين",
  "nameEn": "Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "661",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "662",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6621",
  "name": "مخصص ديون مشكوك فيها (مصروف الفترة)",
  "nameEn": "Doubtful Debts Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6622",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "7",
  "name": "إيرادات ومصروفات أخرى",
  "nameEn": "Other Income and Expenses",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "71",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "711",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 3,
  "parentCode": "71",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7111",
  "name": "إيراد فوائد ودائع بنكية",
  "nameEn": "Bank Deposit Interest Income",
  "type": "revenue",
  "level": 4,
  "parentCode": "711",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "72",
  "name": "التكاليف التمويلية",
  "nameEn": "Financing Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "721",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "revenue",
  "level": 3,
  "parentCode": "72",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7211",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "721",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "73",
  "name": "أرباح وخسائر غير تشغيلية",
  "nameEn": "Non-Operating Gains and Losses",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "731",
  "name": "أرباح/خسائر استبعاد أصول وفروق عملة",
  "nameEn": "Gains/Losses on Asset Disposal and FX Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "73",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7311",
  "name": "أرباح/خسائر بيع أصول ثابتة",
  "nameEn": "Gain/Loss on Sale of Fixed Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "731",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "74",
  "name": "فروقات العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "741",
  "name": "فروقات صرف العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "74",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7411",
  "name": "فروقات صرف عملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 4,
  "parentCode": "741",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8",
  "name": "حسابات ختامية ورقابية",
  "nameEn": "Closing and Control Accounts",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "81",
  "name": "حساب الأرباح والخسائر",
  "nameEn": "Profit and Loss Account",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "811",
  "name": "ملخص الدخل",
  "nameEn": "Income Summary",
  "type": "liability",
  "level": 3,
  "parentCode": "81",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8111",
  "name": "حساب الأرباح والخسائر (إقفال)",
  "nameEn": "Profit and Loss Account (Closing)",
  "type": "equity",
  "level": 4,
  "parentCode": "811",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "82",
  "name": "حسابات نظامية (تحت الرقابة)",
  "nameEn": "Statutory Control Accounts",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "821",
  "name": "التزامات محتملة وضمانات",
  "nameEn": "Contingent Liabilities and Guarantees",
  "type": "liability",
  "level": 3,
  "parentCode": "82",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8211",
  "name": "ضمانات بنكية صادرة",
  "nameEn": "Bank Guarantees Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8212",
  "name": "التزامات محتملة (Contingent Liabilities)",
  "nameEn": "Contingent Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2130",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6220",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1210",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
}
  ],
  general_trade: [
{
  "code": "1",
  "name": "الأصول",
  "nameEn": "Assets",
  "type": "asset",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "11",
  "name": "الأصول المتداولة",
  "nameEn": "Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "111",
  "name": "النقدية وما في حكمها",
  "nameEn": "Cash and Cash Equivalents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1111",
  "name": "الصندوق النقدي - الإدارة العامة",
  "nameEn": "Cash on Hand - Head Office",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1112",
  "name": "صندوق نثرية الفروع/المواقع",
  "nameEn": "Petty Cash - Branches/Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1113",
  "name": "بنك - حساب جاري (1)",
  "nameEn": "Bank - Current Account (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1114",
  "name": "بنك - حساب جاري (2)",
  "nameEn": "Bank - Current Account (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1115",
  "name": "ودائع بنكية قصيرة الأجل",
  "nameEn": "Short-Term Bank Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "112",
  "name": "الذمم المدينة التجارية",
  "nameEn": "Trade Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1121",
  "name": "عملاء - مبيعات جملة/عقود",
  "nameEn": "Customers - Wholesale/Contract Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1122",
  "name": "عملاء - مبيعات نقدية/تجزئة",
  "nameEn": "Customers - Cash/Retail Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1123",
  "name": "أوراق قبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1124",
  "name": "عملاء - أطراف ذات علاقة",
  "nameEn": "Customers - Related Parties",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1125",
  "name": "مخصص ديون مشكوك في تحصيلها (عكسي)",
  "nameEn": "Allowance for Doubtful Debts (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113",
  "name": "ذمم مدينة أخرى",
  "nameEn": "Other Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1131",
  "name": "دفعات مقدمة لموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1132",
  "name": "سلف وقروض الموظفين",
  "nameEn": "Employee Advances and Loans",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1133",
  "name": "ضريبة القيمة المضافة - مدينة (مشتريات)",
  "nameEn": "VAT Receivable (Purchases)",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1134",
  "name": "تأمينات وودائع قابلة للاسترداد",
  "nameEn": "Refundable Deposits and Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1135",
  "name": "عمولات مستحقة من الموردين/الوكالات",
  "nameEn": "Accrued Commissions from Suppliers/Agencies",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "114",
  "name": "المخزون",
  "nameEn": "Inventory",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1141",
  "name": "مخزون بضاعة للبيع - محلي",
  "nameEn": "Merchandise Inventory for Sale - Local",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1142",
  "name": "مخزون بضاعة للتصدير",
  "nameEn": "Merchandise Inventory for Export",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1143",
  "name": "بضاعة بالطريق (شحنات مستوردة)",
  "nameEn": "Goods in Transit (Imported Shipments)",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115",
  "name": "مصروفات مدفوعة مقدماً",
  "nameEn": "Prepaid Expenses",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1151",
  "name": "إيجارات مدفوعة مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1152",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1153",
  "name": "اشتراكات ورخص مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions and Licenses",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "116",
  "name": "اعتمادات مستندية ومستندات شحن",
  "nameEn": "Letters of Credit and Shipping Documents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1161",
  "name": "اعتمادات مستندية (LC) مفتوحة",
  "nameEn": "Open Letters of Credit (LC)",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1162",
  "name": "مستندات شحن تحت التحصيل",
  "nameEn": "Shipping Documents Under Collection",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "12",
  "name": "الأصول غير المتداولة",
  "nameEn": "Non-Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "121",
  "name": "الممتلكات والآلات والمعدات",
  "nameEn": "Property, Plant and Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1211",
  "name": "أراضٍ",
  "nameEn": "Land",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1212",
  "name": "مباني ومنشآت",
  "nameEn": "Buildings and Structures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1213",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1214",
  "name": "سيارات ووسائل نقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1215",
  "name": "أثاث وتجهيزات مكتبية",
  "nameEn": "Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1216",
  "name": "أجهزة حاسب آلي",
  "nameEn": "Computer Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1217",
  "name": "تحسينات على مأجور",
  "nameEn": "Leasehold Improvements",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1218",
  "name": "مجمع الإهلاك (عكسي)",
  "nameEn": "Accumulated Depreciation (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122",
  "name": "أصول غير ملموسة",
  "nameEn": "Intangible Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1221",
  "name": "برامج وأنظمة",
  "nameEn": "Software and Systems",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1222",
  "name": "شهرة المحل",
  "nameEn": "Goodwill",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1223",
  "name": "تراخيص وامتيازات تجارية",
  "nameEn": "Commercial Licenses and Franchises",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1224",
  "name": "مجمع الاستهلاك (عكسي)",
  "nameEn": "Accumulated Amortization (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "123",
  "name": "استثمارات وأصول أخرى غير متداولة",
  "nameEn": "Investments and Other Non-Current Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1231",
  "name": "استثمارات طويلة الأجل",
  "nameEn": "Long-Term Investments",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1232",
  "name": "تأمينات مستردة طويلة الأجل",
  "nameEn": "Long-Term Refundable Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1233",
  "name": "حق استخدام أصول مستأجرة (IFRS16)",
  "nameEn": "Right-of-Use Assets (IFRS16)",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2",
  "name": "الالتزامات",
  "nameEn": "Liabilities",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "21",
  "name": "الالتزامات المتداولة",
  "nameEn": "Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "211",
  "name": "الذمم الدائنة التجارية",
  "nameEn": "Trade Payables",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2111",
  "name": "موردون - محليون",
  "nameEn": "Suppliers - Local",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2112",
  "name": "موردون - مستوردون",
  "nameEn": "Suppliers - Importers",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2113",
  "name": "أوراق دفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2114",
  "name": "موردون - أطراف ذات علاقة",
  "nameEn": "Suppliers - Related Parties",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2115",
  "name": "موردون أجانب - تصدير/استيراد",
  "nameEn": "Foreign Suppliers - Export/Import",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212",
  "name": "مصروفات مستحقة",
  "nameEn": "Accrued Expenses",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2121",
  "name": "رواتب مستحقة",
  "nameEn": "Accrued Salaries",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2122",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2123",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2124",
  "name": "مكافأة نهاية الخدمة - الجزء المتداول",
  "nameEn": "End of Service Benefits - Current Portion",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213",
  "name": "التزامات ضريبية وزكوية",
  "nameEn": "Tax and Zakat Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2131",
  "name": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "nameEn": "VAT Payable (Sales)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2132",
  "name": "الزكاة المستحقة",
  "nameEn": "Zakat Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2133",
  "name": "ضريبة الاستقطاع",
  "nameEn": "Withholding Tax",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "214",
  "name": "قروض قصيرة الأجل",
  "nameEn": "Short-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2141",
  "name": "قرض بنكي قصير الأجل",
  "nameEn": "Short-Term Bank Loan",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2142",
  "name": "الجزء المتداول من القروض طويلة الأجل",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "215",
  "name": "دفعات مقدمة ومستحقات عقود",
  "nameEn": "Advances and Contract Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2151",
  "name": "دفعات مقدمة من عملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "216",
  "name": "رسوم ومستحقات تجارة خارجية",
  "nameEn": "Foreign Trade Fees and Dues",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2161",
  "name": "رسوم جمركية مستحقة",
  "nameEn": "Accrued Customs Duties",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2162",
  "name": "اعتمادات مستندية دائنة",
  "nameEn": "Letters of Credit Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "22",
  "name": "الالتزامات غير المتداولة",
  "nameEn": "Non-Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "221",
  "name": "قروض طويلة الأجل",
  "nameEn": "Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2211",
  "name": "قروض بنكية طويلة الأجل",
  "nameEn": "Long-Term Bank Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "221",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "222",
  "name": "مخصص مكافأة نهاية الخدمة",
  "nameEn": "End of Service Benefits Provision",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2221",
  "name": "مخصص نهاية الخدمة - طويل الأجل",
  "nameEn": "End of Service Provision - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "222",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "223",
  "name": "التزامات عقود الإيجار (IFRS16)",
  "nameEn": "Lease Liabilities (IFRS16)",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2231",
  "name": "التزام عقد إيجار - طويل الأجل",
  "nameEn": "Lease Liability - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "223",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3",
  "name": "حقوق الملكية",
  "nameEn": "Equity",
  "type": "equity",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "31",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "311",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3111",
  "name": "رأس المال المدفوع",
  "nameEn": "Paid-up Capital",
  "type": "equity",
  "level": 4,
  "parentCode": "311",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "32",
  "name": "الاحتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "321",
  "name": "احتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 3,
  "parentCode": "32",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3211",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3212",
  "name": "احتياطي عام",
  "nameEn": "General Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "33",
  "name": "الأرباح المرحلة",
  "nameEn": "Retained Earnings",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "331",
  "name": "الأرباح والخسائر المتراكمة",
  "nameEn": "Accumulated Retained Earnings",
  "type": "equity",
  "level": 3,
  "parentCode": "33",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3311",
  "name": "أرباح مرحلة من سنوات سابقة",
  "nameEn": "Retained Earnings from Prior Years",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3312",
  "name": "صافي ربح / خسارة العام الحالي",
  "nameEn": "Net Income / Loss for the Current Year",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3313",
  "name": "توزيعات أرباح (عكسي)",
  "nameEn": "Dividends (Contra)",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "34",
  "name": "حساب الشركاء الجاري",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "341",
  "name": "الحساب الجاري للشركاء",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 3,
  "parentCode": "34",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3411",
  "name": "جاري الشركاء / المساهمين",
  "nameEn": "Partners' / Shareholders' Current Account",
  "type": "equity",
  "level": 4,
  "parentCode": "341",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4",
  "name": "الإيرادات",
  "nameEn": "Revenue",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "41",
  "name": "إيرادات النشاط الرئيسي",
  "nameEn": "Core Business Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "411",
  "name": "إيرادات النشاط",
  "nameEn": "Operating Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4111",
  "name": "إيرادات مبيعات محلية",
  "nameEn": "Local Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4112",
  "name": "إيرادات مبيعات تصدير",
  "nameEn": "Export Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4113",
  "name": "إيرادات عمولات وساطة تجارية",
  "nameEn": "Trade Brokerage Commission Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4114",
  "name": "إيرادات إعادة تصدير (Re-export)",
  "nameEn": "Re-export Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "42",
  "name": "مردودات ومسموحات المبيعات",
  "nameEn": "Sales Returns and Allowances",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "421",
  "name": "مردودات مبيعات",
  "nameEn": "Sales Returns",
  "type": "revenue",
  "level": 3,
  "parentCode": "42",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4211",
  "name": "مردودات وخصم مسموح به (عكسي)",
  "nameEn": "Returns and Allowances (Contra)",
  "type": "revenue",
  "level": 4,
  "parentCode": "421",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "43",
  "name": "إيرادات أخرى",
  "nameEn": "Other Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "431",
  "name": "إيرادات متنوعة",
  "nameEn": "Miscellaneous Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "43",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4311",
  "name": "إيراد بيع خردة / أصول",
  "nameEn": "Gain on Sale of Scrap / Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4312",
  "name": "إيرادات متنوعة أخرى",
  "nameEn": "Other Miscellaneous Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "51",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "511",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5111",
  "name": "تكلفة شراء البضاعة",
  "nameEn": "Cost of Goods Purchased",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5112",
  "name": "رسوم جمركية وتخليص",
  "nameEn": "Customs Duties and Clearance Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5113",
  "name": "مصاريف شحن وتأمين بضاعة (Freight & Insurance)",
  "nameEn": "Freight and Insurance Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5114",
  "name": "مصاريف تخزين ومناولة",
  "nameEn": "Storage and Handling Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6",
  "name": "المصروفات التشغيلية",
  "nameEn": "Operating Expenses",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "61",
  "name": "الرواتب والأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "611",
  "name": "رواتب وأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 3,
  "parentCode": "61",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6111",
  "name": "رواتب الموظفين - الإدارة العامة",
  "nameEn": "Employee Salaries - Head Office",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6112",
  "name": "رواتب موظفي الميدان/الموقع",
  "nameEn": "Field/Site Staff Salaries",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6113",
  "name": "بدلات ومكافآت",
  "nameEn": "Allowances and Bonuses",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6114",
  "name": "التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6115",
  "name": "التأمين الطبي",
  "nameEn": "Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6116",
  "name": "مكافأة نهاية الخدمة (مصروف الفترة)",
  "nameEn": "End of Service Benefits Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "62",
  "name": "المصروفات الإدارية والعمومية",
  "nameEn": "General and Administrative Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "621",
  "name": "إيجارات ومصروفات إدارية",
  "nameEn": "Rent and Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6211",
  "name": "إيجار المقر الرئيسي",
  "nameEn": "Head Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6212",
  "name": "إيجار مواقع/فروع",
  "nameEn": "Site/Branch Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622",
  "name": "مصروفات إدارية عامة أخرى",
  "nameEn": "Other General Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6221",
  "name": "قرطاسية ومطبوعات",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6222",
  "name": "اتصالات وإنترنت",
  "nameEn": "Telecommunications and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6223",
  "name": "صيانة أجهزة وبرامج",
  "nameEn": "Hardware and Software Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "623",
  "name": "أتعاب ورسوم",
  "nameEn": "Professional Fees",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6231",
  "name": "أتعاب محاسبة ومراجعة",
  "nameEn": "Accounting and Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6232",
  "name": "أتعاب استشارات قانونية",
  "nameEn": "Legal Consulting Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "624",
  "name": "رسوم ورخص حكومية",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6241",
  "name": "رسوم حكومية وتراخيص",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 4,
  "parentCode": "624",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "63",
  "name": "مصروفات البيع والتسويق",
  "nameEn": "Selling and Marketing Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "631",
  "name": "دعاية وإعلان",
  "nameEn": "Advertising and Promotion",
  "type": "expense",
  "level": 3,
  "parentCode": "63",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6311",
  "name": "حملات تسويقية وإعلانية",
  "nameEn": "Marketing and Advertising Campaigns",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6312",
  "name": "عمولات مبيعات",
  "nameEn": "Sales Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "64",
  "name": "مصروفات الصيانة والمرافق",
  "nameEn": "Maintenance and Utilities Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "641",
  "name": "صيانة ومرافق",
  "nameEn": "Maintenance and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6411",
  "name": "صيانة دورية للمعدات/المنشآت",
  "nameEn": "Periodic Maintenance of Equipment/Facilities",
  "type": "expense",
  "level": 4,
  "parentCode": "641",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "642",
  "name": "المرافق العامة",
  "nameEn": "Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6421",
  "name": "كهرباء ومياه",
  "nameEn": "Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "642",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "65",
  "name": "الإهلاك والاستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "651",
  "name": "إهلاك واستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6511",
  "name": "إهلاك الممتلكات والمعدات",
  "nameEn": "Depreciation of Property and Equipment",
  "type": "expense",
  "level": 4,
  "parentCode": "651",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "652",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6521",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "652",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "66",
  "name": "مصروفات أخرى تشغيلية",
  "nameEn": "Other Operating Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "661",
  "name": "تأمين ومخصصات",
  "nameEn": "Insurance and Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6611",
  "name": "تأمين",
  "nameEn": "Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "661",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "662",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6621",
  "name": "مخصص ديون مشكوك فيها (مصروف الفترة)",
  "nameEn": "Doubtful Debts Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6622",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "7",
  "name": "إيرادات ومصروفات أخرى",
  "nameEn": "Other Income and Expenses",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "71",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "711",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 3,
  "parentCode": "71",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7111",
  "name": "إيراد فوائد ودائع بنكية",
  "nameEn": "Bank Deposit Interest Income",
  "type": "revenue",
  "level": 4,
  "parentCode": "711",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "72",
  "name": "التكاليف التمويلية",
  "nameEn": "Financing Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "721",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "revenue",
  "level": 3,
  "parentCode": "72",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7211",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "721",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "73",
  "name": "أرباح وخسائر غير تشغيلية",
  "nameEn": "Non-Operating Gains and Losses",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "731",
  "name": "أرباح/خسائر استبعاد أصول وفروق عملة",
  "nameEn": "Gains/Losses on Asset Disposal and FX Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "73",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7311",
  "name": "أرباح/خسائر بيع أصول ثابتة",
  "nameEn": "Gain/Loss on Sale of Fixed Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "731",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "74",
  "name": "فروقات العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "741",
  "name": "فروقات صرف العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "74",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7411",
  "name": "فروقات صرف عملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 4,
  "parentCode": "741",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8",
  "name": "حسابات ختامية ورقابية",
  "nameEn": "Closing and Control Accounts",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "81",
  "name": "حساب الأرباح والخسائر",
  "nameEn": "Profit and Loss Account",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "811",
  "name": "ملخص الدخل",
  "nameEn": "Income Summary",
  "type": "liability",
  "level": 3,
  "parentCode": "81",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8111",
  "name": "حساب الأرباح والخسائر (إقفال)",
  "nameEn": "Profit and Loss Account (Closing)",
  "type": "equity",
  "level": 4,
  "parentCode": "811",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "82",
  "name": "حسابات نظامية (تحت الرقابة)",
  "nameEn": "Statutory Control Accounts",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "821",
  "name": "التزامات محتملة وضمانات",
  "nameEn": "Contingent Liabilities and Guarantees",
  "type": "liability",
  "level": 3,
  "parentCode": "82",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8211",
  "name": "ضمانات بنكية صادرة",
  "nameEn": "Bank Guarantees Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8212",
  "name": "التزامات محتملة (Contingent Liabilities)",
  "nameEn": "Contingent Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2130",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6220",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1210",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5110",
  "name": "فروقات وهبوط مخزون",
  "nameEn": "Inventory Adjustments and Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
}
  ],
  fuel_stations: [
{
  "code": "1",
  "name": "الأصول",
  "nameEn": "Assets",
  "type": "asset",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "11",
  "name": "الأصول المتداولة",
  "nameEn": "Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "111",
  "name": "النقدية وما في حكمها",
  "nameEn": "Cash and Cash Equivalents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1111",
  "name": "الصندوق النقدي - الإدارة العامة",
  "nameEn": "Cash on Hand - Head Office",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1112",
  "name": "صندوق نثرية الفروع/المواقع",
  "nameEn": "Petty Cash - Branches/Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1113",
  "name": "بنك - حساب جاري (1)",
  "nameEn": "Bank - Current Account (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1114",
  "name": "بنك - حساب جاري (2)",
  "nameEn": "Bank - Current Account (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1115",
  "name": "ودائع بنكية قصيرة الأجل",
  "nameEn": "Short-Term Bank Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "112",
  "name": "الذمم المدينة التجارية",
  "nameEn": "Trade Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1121",
  "name": "عملاء - مبيعات جملة/عقود",
  "nameEn": "Customers - Wholesale/Contract Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1122",
  "name": "عملاء - مبيعات نقدية/تجزئة",
  "nameEn": "Customers - Cash/Retail Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1123",
  "name": "أوراق قبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1124",
  "name": "عملاء - أطراف ذات علاقة",
  "nameEn": "Customers - Related Parties",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1125",
  "name": "مخصص ديون مشكوك في تحصيلها (عكسي)",
  "nameEn": "Allowance for Doubtful Debts (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1126",
  "name": "ذمم شركات بطاقات الوقود/الأسطول",
  "nameEn": "Fuel/Fleet Card Companies Receivables",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113",
  "name": "ذمم مدينة أخرى",
  "nameEn": "Other Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1131",
  "name": "دفعات مقدمة لموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1132",
  "name": "سلف وقروض الموظفين",
  "nameEn": "Employee Advances and Loans",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1133",
  "name": "ضريبة القيمة المضافة - مدينة (مشتريات)",
  "nameEn": "VAT Receivable (Purchases)",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1134",
  "name": "تأمينات وودائع قابلة للاسترداد",
  "nameEn": "Refundable Deposits and Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "114",
  "name": "المخزون",
  "nameEn": "Inventory",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1141",
  "name": "مخزون الوقود (بنزين 91/95)",
  "nameEn": "Fuel Inventory (Petrol 91/95)",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1142",
  "name": "مخزون الديزل",
  "nameEn": "Diesel Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1143",
  "name": "مخزون زيوت وقطع غيار",
  "nameEn": "Oils and Spare Parts Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1144",
  "name": "مخزون بضاعة المتجر/البقالة الداخلية",
  "nameEn": "Convenience Store Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115",
  "name": "مصروفات مدفوعة مقدماً",
  "nameEn": "Prepaid Expenses",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1151",
  "name": "إيجارات مدفوعة مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1152",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1153",
  "name": "اشتراكات ورخص مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions and Licenses",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "116",
  "name": "رسوم ومستحقات تنظيمية",
  "nameEn": "Regulatory Fees and Dues",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1161",
  "name": "مستحقات هيئة تنظيم الطاقة (تسعيرة/دعم)",
  "nameEn": "Energy Regulatory Authority Dues (Pricing/Subsidy)",
  "type": "asset",
  "level": 4,
  "parentCode": "116",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "12",
  "name": "الأصول غير المتداولة",
  "nameEn": "Non-Current Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "121",
  "name": "الممتلكات والآلات والمعدات",
  "nameEn": "Property, Plant and Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1211",
  "name": "أراضٍ",
  "nameEn": "Land",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1212",
  "name": "مباني ومنشآت",
  "nameEn": "Buildings and Structures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1213",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1214",
  "name": "سيارات ووسائل نقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1215",
  "name": "أثاث وتجهيزات مكتبية",
  "nameEn": "Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1216",
  "name": "أجهزة حاسب آلي",
  "nameEn": "Computer Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1217",
  "name": "تحسينات على مأجور",
  "nameEn": "Leasehold Improvements",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1219",
  "name": "خزانات وقود ومضخات",
  "nameEn": "Fuel Tanks and Pumps",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1218",
  "name": "مجمع الإهلاك (عكسي)",
  "nameEn": "Accumulated Depreciation (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122",
  "name": "أصول غير ملموسة",
  "nameEn": "Intangible Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1221",
  "name": "برامج وأنظمة",
  "nameEn": "Software and Systems",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1222",
  "name": "شهرة المحل",
  "nameEn": "Goodwill",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1223",
  "name": "تراخيص وامتيازات تجارية",
  "nameEn": "Commercial Licenses and Franchises",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1224",
  "name": "مجمع الاستهلاك (عكسي)",
  "nameEn": "Accumulated Amortization (Contra)",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "123",
  "name": "استثمارات وأصول أخرى غير متداولة",
  "nameEn": "Investments and Other Non-Current Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1231",
  "name": "استثمارات طويلة الأجل",
  "nameEn": "Long-Term Investments",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1232",
  "name": "تأمينات مستردة طويلة الأجل",
  "nameEn": "Long-Term Refundable Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1233",
  "name": "حق استخدام أصول مستأجرة (IFRS16)",
  "nameEn": "Right-of-Use Assets (IFRS16)",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2",
  "name": "الالتزامات",
  "nameEn": "Liabilities",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "21",
  "name": "الالتزامات المتداولة",
  "nameEn": "Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "211",
  "name": "الذمم الدائنة التجارية",
  "nameEn": "Trade Payables",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2111",
  "name": "موردون - محليون",
  "nameEn": "Suppliers - Local",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2112",
  "name": "موردون - مستوردون",
  "nameEn": "Suppliers - Importers",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2113",
  "name": "أوراق دفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2114",
  "name": "موردون - أطراف ذات علاقة",
  "nameEn": "Suppliers - Related Parties",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212",
  "name": "مصروفات مستحقة",
  "nameEn": "Accrued Expenses",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2121",
  "name": "رواتب مستحقة",
  "nameEn": "Accrued Salaries",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2122",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2123",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2124",
  "name": "مكافأة نهاية الخدمة - الجزء المتداول",
  "nameEn": "End of Service Benefits - Current Portion",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213",
  "name": "التزامات ضريبية وزكوية",
  "nameEn": "Tax and Zakat Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2131",
  "name": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "nameEn": "VAT Payable (Sales)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2132",
  "name": "الزكاة المستحقة",
  "nameEn": "Zakat Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2133",
  "name": "ضريبة الاستقطاع",
  "nameEn": "Withholding Tax",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "214",
  "name": "قروض قصيرة الأجل",
  "nameEn": "Short-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2141",
  "name": "قرض بنكي قصير الأجل",
  "nameEn": "Short-Term Bank Loan",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2142",
  "name": "الجزء المتداول من القروض طويلة الأجل",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "215",
  "name": "دفعات مقدمة ومستحقات عقود",
  "nameEn": "Advances and Contract Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2151",
  "name": "دفعات مقدمة من عملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "216",
  "name": "رسوم ومتطلبات وزارة الطاقة",
  "nameEn": "Ministry of Energy Fees and Requirements",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2161",
  "name": "رسوم ترخيص محطات مستحقة",
  "nameEn": "Accrued Station Licensing Fees",
  "type": "liability",
  "level": 4,
  "parentCode": "216",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "22",
  "name": "الالتزامات غير المتداولة",
  "nameEn": "Non-Current Liabilities",
  "type": "liability",
  "level": 2,
  "parentCode": "2",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "221",
  "name": "قروض طويلة الأجل",
  "nameEn": "Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2211",
  "name": "قروض بنكية طويلة الأجل",
  "nameEn": "Long-Term Bank Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "221",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "222",
  "name": "مخصص مكافأة نهاية الخدمة",
  "nameEn": "End of Service Benefits Provision",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2221",
  "name": "مخصص نهاية الخدمة - طويل الأجل",
  "nameEn": "End of Service Provision - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "222",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "223",
  "name": "التزامات عقود الإيجار (IFRS16)",
  "nameEn": "Lease Liabilities (IFRS16)",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "2231",
  "name": "التزام عقد إيجار - طويل الأجل",
  "nameEn": "Lease Liability - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "223",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3",
  "name": "حقوق الملكية",
  "nameEn": "Equity",
  "type": "equity",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "31",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "311",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3111",
  "name": "رأس المال المدفوع",
  "nameEn": "Paid-up Capital",
  "type": "equity",
  "level": 4,
  "parentCode": "311",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "32",
  "name": "الاحتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "321",
  "name": "احتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 3,
  "parentCode": "32",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3211",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3212",
  "name": "احتياطي عام",
  "nameEn": "General Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "33",
  "name": "الأرباح المرحلة",
  "nameEn": "Retained Earnings",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "331",
  "name": "الأرباح والخسائر المتراكمة",
  "nameEn": "Accumulated Retained Earnings",
  "type": "equity",
  "level": 3,
  "parentCode": "33",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3311",
  "name": "أرباح مرحلة من سنوات سابقة",
  "nameEn": "Retained Earnings from Prior Years",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3312",
  "name": "صافي ربح / خسارة العام الحالي",
  "nameEn": "Net Income / Loss for the Current Year",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3313",
  "name": "توزيعات أرباح (عكسي)",
  "nameEn": "Dividends (Contra)",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "34",
  "name": "حساب الشركاء الجاري",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "341",
  "name": "الحساب الجاري للشركاء",
  "nameEn": "Partners' Current Account",
  "type": "equity",
  "level": 3,
  "parentCode": "34",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3411",
  "name": "جاري الشركاء / المساهمين",
  "nameEn": "Partners' / Shareholders' Current Account",
  "type": "equity",
  "level": 4,
  "parentCode": "341",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4",
  "name": "الإيرادات",
  "nameEn": "Revenue",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "41",
  "name": "إيرادات النشاط الرئيسي",
  "nameEn": "Core Business Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "411",
  "name": "إيرادات النشاط",
  "nameEn": "Operating Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4111",
  "name": "إيراد مبيعات بنزين 91",
  "nameEn": "Petrol 91 Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4112",
  "name": "إيراد مبيعات بنزين 95",
  "nameEn": "Petrol 95 Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4113",
  "name": "إيراد مبيعات ديزل",
  "nameEn": "Diesel Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4114",
  "name": "إيراد خدمات تغيير الزيت والصيانة السريعة",
  "nameEn": "Oil Change and Quick Maintenance Services Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4115",
  "name": "إيراد غسيل وتلميع السيارات",
  "nameEn": "Car Wash and Polish Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4116",
  "name": "إيراد إيجار وحدات تجارية بالمحطة (متجر/مطعم)",
  "nameEn": "Station Commercial Unit Rental Revenue (Shop/Restaurant)",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "42",
  "name": "مردودات ومسموحات المبيعات",
  "nameEn": "Sales Returns and Allowances",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "421",
  "name": "مردودات مبيعات",
  "nameEn": "Sales Returns",
  "type": "revenue",
  "level": 3,
  "parentCode": "42",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4211",
  "name": "مردودات وخصم مسموح به (عكسي)",
  "nameEn": "Returns and Allowances (Contra)",
  "type": "revenue",
  "level": 4,
  "parentCode": "421",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "43",
  "name": "إيرادات أخرى",
  "nameEn": "Other Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "431",
  "name": "إيرادات متنوعة",
  "nameEn": "Miscellaneous Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "43",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4311",
  "name": "إيراد بيع خردة / أصول",
  "nameEn": "Gain on Sale of Scrap / Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4312",
  "name": "إيرادات متنوعة أخرى",
  "nameEn": "Other Miscellaneous Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "51",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "511",
  "name": "تكلفة الإيرادات",
  "nameEn": "Cost of Revenue",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5111",
  "name": "تكلفة شراء الوقود (بنزين وديزل)",
  "nameEn": "Fuel Purchase Cost (Petrol and Diesel)",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5112",
  "name": "مصاريف نقل ومناولة الوقود",
  "nameEn": "Fuel Transport and Handling Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5113",
  "name": "تكلفة قطع غيار وزيوت مستخدمة",
  "nameEn": "Spare Parts and Oils Used Cost",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5114",
  "name": "فاقد وعجز قياس الخزانات (Ullage)",
  "nameEn": "Tank Gauging Loss (Ullage)",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6",
  "name": "المصروفات التشغيلية",
  "nameEn": "Operating Expenses",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "61",
  "name": "الرواتب والأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "611",
  "name": "رواتب وأجور",
  "nameEn": "Salaries and Wages",
  "type": "expense",
  "level": 3,
  "parentCode": "61",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6111",
  "name": "رواتب الموظفين - الإدارة العامة",
  "nameEn": "Employee Salaries - Head Office",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6112",
  "name": "رواتب موظفي الميدان/الموقع",
  "nameEn": "Field/Site Staff Salaries",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6113",
  "name": "بدلات ومكافآت",
  "nameEn": "Allowances and Bonuses",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6114",
  "name": "التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6115",
  "name": "التأمين الطبي",
  "nameEn": "Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6116",
  "name": "مكافأة نهاية الخدمة (مصروف الفترة)",
  "nameEn": "End of Service Benefits Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "62",
  "name": "المصروفات الإدارية والعمومية",
  "nameEn": "General and Administrative Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "621",
  "name": "إيجارات ومصروفات إدارية",
  "nameEn": "Rent and Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6211",
  "name": "إيجار المقر الرئيسي",
  "nameEn": "Head Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6212",
  "name": "إيجار مواقع/فروع",
  "nameEn": "Site/Branch Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622",
  "name": "مصروفات إدارية عامة أخرى",
  "nameEn": "Other General Administrative Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6221",
  "name": "قرطاسية ومطبوعات",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6222",
  "name": "اتصالات وإنترنت",
  "nameEn": "Telecommunications and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6223",
  "name": "صيانة أجهزة وبرامج",
  "nameEn": "Hardware and Software Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "623",
  "name": "أتعاب ورسوم",
  "nameEn": "Professional Fees",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6231",
  "name": "أتعاب محاسبة ومراجعة",
  "nameEn": "Accounting and Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6232",
  "name": "أتعاب استشارات قانونية",
  "nameEn": "Legal Consulting Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "624",
  "name": "رسوم ورخص حكومية",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 3,
  "parentCode": "62",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6241",
  "name": "رسوم حكومية وتراخيص",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 4,
  "parentCode": "624",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "63",
  "name": "مصروفات البيع والتسويق",
  "nameEn": "Selling and Marketing Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "631",
  "name": "دعاية وإعلان",
  "nameEn": "Advertising and Promotion",
  "type": "expense",
  "level": 3,
  "parentCode": "63",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6311",
  "name": "حملات تسويقية وإعلانية",
  "nameEn": "Marketing and Advertising Campaigns",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6312",
  "name": "عمولات مبيعات",
  "nameEn": "Sales Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "64",
  "name": "مصروفات الصيانة والمرافق",
  "nameEn": "Maintenance and Utilities Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "641",
  "name": "صيانة ومرافق",
  "nameEn": "Maintenance and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6411",
  "name": "صيانة دورية للمعدات/المنشآت",
  "nameEn": "Periodic Maintenance of Equipment/Facilities",
  "type": "expense",
  "level": 4,
  "parentCode": "641",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "642",
  "name": "المرافق العامة",
  "nameEn": "Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "64",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6421",
  "name": "كهرباء ومياه",
  "nameEn": "Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "642",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "65",
  "name": "الإهلاك والاستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "651",
  "name": "إهلاك واستهلاك",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6511",
  "name": "إهلاك الممتلكات والمعدات",
  "nameEn": "Depreciation of Property and Equipment",
  "type": "expense",
  "level": 4,
  "parentCode": "651",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "652",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 3,
  "parentCode": "65",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6521",
  "name": "استهلاك الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "652",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "66",
  "name": "مصروفات أخرى تشغيلية",
  "nameEn": "Other Operating Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "6",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "661",
  "name": "تأمين ومخصصات",
  "nameEn": "Insurance and Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6611",
  "name": "تأمين",
  "nameEn": "Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "661",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "662",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "66",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "6621",
  "name": "مخصص ديون مشكوك فيها (مصروف الفترة)",
  "nameEn": "Doubtful Debts Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6622",
  "name": "مخصصات أخرى",
  "nameEn": "Other Provisions",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "7",
  "name": "إيرادات ومصروفات أخرى",
  "nameEn": "Other Income and Expenses",
  "type": "revenue",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "71",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "711",
  "name": "إيرادات وتكاليف تمويلية",
  "nameEn": "Financing Income and Costs",
  "type": "revenue",
  "level": 3,
  "parentCode": "71",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7111",
  "name": "إيراد فوائد ودائع بنكية",
  "nameEn": "Bank Deposit Interest Income",
  "type": "revenue",
  "level": 4,
  "parentCode": "711",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "72",
  "name": "التكاليف التمويلية",
  "nameEn": "Financing Costs",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "721",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "revenue",
  "level": 3,
  "parentCode": "72",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7211",
  "name": "فوائد ومصاريف تمويل",
  "nameEn": "Interest and Financing Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "721",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "73",
  "name": "أرباح وخسائر غير تشغيلية",
  "nameEn": "Non-Operating Gains and Losses",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "731",
  "name": "أرباح/خسائر استبعاد أصول وفروق عملة",
  "nameEn": "Gains/Losses on Asset Disposal and FX Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "73",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7311",
  "name": "أرباح/خسائر بيع أصول ثابتة",
  "nameEn": "Gain/Loss on Sale of Fixed Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "731",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "74",
  "name": "فروقات العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 2,
  "parentCode": "7",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "741",
  "name": "فروقات صرف العملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 3,
  "parentCode": "74",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "7411",
  "name": "فروقات صرف عملة",
  "nameEn": "Foreign Exchange Differences",
  "type": "revenue",
  "level": 4,
  "parentCode": "741",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8",
  "name": "حسابات ختامية ورقابية",
  "nameEn": "Closing and Control Accounts",
  "type": "liability",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "81",
  "name": "حساب الأرباح والخسائر",
  "nameEn": "Profit and Loss Account",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "811",
  "name": "ملخص الدخل",
  "nameEn": "Income Summary",
  "type": "liability",
  "level": 3,
  "parentCode": "81",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8111",
  "name": "حساب الأرباح والخسائر (إقفال)",
  "nameEn": "Profit and Loss Account (Closing)",
  "type": "equity",
  "level": 4,
  "parentCode": "811",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "82",
  "name": "حسابات نظامية (تحت الرقابة)",
  "nameEn": "Statutory Control Accounts",
  "type": "liability",
  "level": 2,
  "parentCode": "8",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "821",
  "name": "التزامات محتملة وضمانات",
  "nameEn": "Contingent Liabilities and Guarantees",
  "type": "liability",
  "level": 3,
  "parentCode": "82",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "8211",
  "name": "ضمانات بنكية صادرة",
  "nameEn": "Bank Guarantees Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "8212",
  "name": "التزامات محتملة (Contingent Liabilities)",
  "nameEn": "Contingent Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2130",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "6220",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1210",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5110",
  "name": "فروقات وهبوط مخزون",
  "nameEn": "Inventory Adjustments and Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
}
  ],
};
