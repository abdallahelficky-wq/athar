import { AccountType, Prisma } from "@prisma/client";

export interface DefaultChartAccount {
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  level: number;
  parentCode: string | null;
  isPosting: boolean;
  isBankOrCash?: boolean;
}

/**
 * شجرة قياسية عامة للشركات التجارية والخدمية.
 * الحسابات القطاعية تُضاف كحزم اختيارية ولا تدخل في القالب الافتراضي.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: DefaultChartAccount[] = [
  {
    "code": "100000000",
    "name": "الأصول",
    "nameEn": "Assets",
    "type": "asset",
    "level": 1,
    "parentCode": null,
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "200000000",
    "name": "الالتزامات",
    "nameEn": "Liabilities",
    "type": "liability",
    "level": 1,
    "parentCode": null,
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "300000000",
    "name": "حقوق الملكية",
    "nameEn": "Equity",
    "type": "equity",
    "level": 1,
    "parentCode": null,
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "400000000",
    "name": "الإيرادات",
    "nameEn": "Revenue",
    "type": "revenue",
    "level": 1,
    "parentCode": null,
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "500000000",
    "name": "المصروفات",
    "nameEn": "Expenses",
    "type": "expense",
    "level": 1,
    "parentCode": null,
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "110000000",
    "name": "الأصول المتداولة",
    "nameEn": "Current Assets",
    "type": "asset",
    "level": 2,
    "parentCode": "100000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "120000000",
    "name": "الأصول غير المتداولة",
    "nameEn": "Non-current Assets",
    "type": "asset",
    "level": 2,
    "parentCode": "100000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "130000000",
    "name": "الممتلكات والآلات والمعدات",
    "nameEn": "Property, Plant and Equipment",
    "type": "asset",
    "level": 2,
    "parentCode": "100000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "210000000",
    "name": "الالتزامات المتداولة",
    "nameEn": "Current Liabilities",
    "type": "liability",
    "level": 2,
    "parentCode": "200000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "220000000",
    "name": "الالتزامات غير المتداولة",
    "nameEn": "Non-current Liabilities",
    "type": "liability",
    "level": 2,
    "parentCode": "200000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "310000000",
    "name": "رأس المال",
    "nameEn": "Capital",
    "type": "equity",
    "level": 2,
    "parentCode": "300000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "320000000",
    "name": "الاحتياطيات",
    "nameEn": "Reserves",
    "type": "equity",
    "level": 2,
    "parentCode": "300000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "330000000",
    "name": "الأرباح والخسائر المتراكمة",
    "nameEn": "Retained Earnings",
    "type": "equity",
    "level": 2,
    "parentCode": "300000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "410000000",
    "name": "إيرادات النشاط الرئيسي",
    "nameEn": "Core Operating Revenue",
    "type": "revenue",
    "level": 2,
    "parentCode": "400000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "420000000",
    "name": "إيرادات تشغيلية أخرى",
    "nameEn": "Other Operating Revenue",
    "type": "revenue",
    "level": 2,
    "parentCode": "400000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "430000000",
    "name": "إيرادات غير تشغيلية",
    "nameEn": "Non-operating Revenue",
    "type": "revenue",
    "level": 2,
    "parentCode": "400000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "510000000",
    "name": "تكلفة المبيعات والتكاليف المباشرة",
    "nameEn": "Cost of Sales and Direct Costs",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "520000000",
    "name": "مصروفات التشغيل",
    "nameEn": "Operating Expenses",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "530000000",
    "name": "المصروفات العمومية والإدارية",
    "nameEn": "General and Administrative Expenses",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "550000000",
    "name": "مصروفات البيع والتسويق",
    "nameEn": "Selling and Marketing Expenses",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "560000000",
    "name": "الإهلاك والإطفاء",
    "nameEn": "Depreciation and Amortization",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "570000000",
    "name": "المصروفات غير التشغيلية وتكاليف التمويل",
    "nameEn": "Non-operating Expenses and Finance Costs",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "580000000",
    "name": "مصروف الزكاة وضريبة الدخل",
    "nameEn": "Zakat and Income Tax Expense",
    "type": "expense",
    "level": 2,
    "parentCode": "500000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "111000000",
    "name": "النقد وما في حكمه",
    "nameEn": "Cash and Cash Equivalents",
    "type": "asset",
    "level": 3,
    "parentCode": "110000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "112000000",
    "name": "الذمم المدينة التجارية",
    "nameEn": "Trade Receivables",
    "type": "asset",
    "level": 3,
    "parentCode": "110000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "113000000",
    "name": "الذمم المدينة الأخرى",
    "nameEn": "Other Receivables",
    "type": "asset",
    "level": 3,
    "parentCode": "110000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "114000000",
    "name": "المخزون",
    "nameEn": "Inventory",
    "type": "asset",
    "level": 3,
    "parentCode": "110000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "115000000",
    "name": "المصروفات المدفوعة مقدماً",
    "nameEn": "Prepaid Expenses",
    "type": "asset",
    "level": 3,
    "parentCode": "110000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "116000000",
    "name": "الضرائب والرسوم المستردة",
    "nameEn": "Recoverable Taxes and Levies",
    "type": "asset",
    "level": 3,
    "parentCode": "110000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "121000000",
    "name": "استثمارات طويلة الأجل",
    "nameEn": "Long-term Investments",
    "type": "asset",
    "level": 3,
    "parentCode": "120000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "122000000",
    "name": "أرصدة مدينة طويلة الأجل",
    "nameEn": "Long-term Receivables",
    "type": "asset",
    "level": 3,
    "parentCode": "120000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "123000000",
    "name": "أصول حق الاستخدام",
    "nameEn": "Right-of-use Assets",
    "type": "asset",
    "level": 3,
    "parentCode": "120000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "124000000",
    "name": "الأصول غير الملموسة",
    "nameEn": "Intangible Assets",
    "type": "asset",
    "level": 3,
    "parentCode": "120000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "131000000",
    "name": "الأراضي",
    "nameEn": "Land",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "132000000",
    "name": "المباني",
    "nameEn": "Buildings",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "133000000",
    "name": "تحسينات المباني والمواقع",
    "nameEn": "Leasehold and Site Improvements",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "134000000",
    "name": "الآلات والمعدات",
    "nameEn": "Machinery and Equipment",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "135000000",
    "name": "المركبات",
    "nameEn": "Vehicles",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "136000000",
    "name": "الأثاث والتجهيزات",
    "nameEn": "Furniture and Fixtures",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "137000000",
    "name": "أجهزة الحاسب وتقنية المعلومات",
    "nameEn": "Computers and IT Equipment",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "138000000",
    "name": "المعدات المكتبية",
    "nameEn": "Office Equipment",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "139000000",
    "name": "مشروعات رأسمالية تحت التنفيذ",
    "nameEn": "Capital Work in Progress",
    "type": "asset",
    "level": 3,
    "parentCode": "130000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "211000000",
    "name": "الذمم الدائنة التجارية",
    "nameEn": "Trade Payables",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "212000000",
    "name": "المصروفات المستحقة",
    "nameEn": "Accrued Expenses",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "213000000",
    "name": "ضرائب وزكاة ورسوم مستحقة",
    "nameEn": "Taxes, Zakat and Levies Payable",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "214000000",
    "name": "التزامات الموظفين والجهات الحكومية",
    "nameEn": "Employee and Statutory Payables",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "215000000",
    "name": "دفعات العملاء والإيرادات المؤجلة",
    "nameEn": "Customer Advances and Deferred Revenue",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "216000000",
    "name": "تمويل والتزامات متداولة",
    "nameEn": "Current Financing Liabilities",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "217000000",
    "name": "ذمم دائنة أخرى",
    "nameEn": "Other Payables",
    "type": "liability",
    "level": 3,
    "parentCode": "210000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "221000000",
    "name": "قروض طويلة الأجل",
    "nameEn": "Long-term Loans",
    "type": "liability",
    "level": 3,
    "parentCode": "220000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "222000000",
    "name": "التزامات إيجار غير متداولة",
    "nameEn": "Non-current Lease Liabilities",
    "type": "liability",
    "level": 3,
    "parentCode": "220000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "223000000",
    "name": "المخصصات طويلة الأجل",
    "nameEn": "Long-term Provisions",
    "type": "liability",
    "level": 3,
    "parentCode": "220000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "224000000",
    "name": "التزام ضريبة مؤجلة",
    "nameEn": "Deferred Tax Liability",
    "type": "liability",
    "level": 3,
    "parentCode": "220000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "311000000",
    "name": "رأس المال المصدر والمدفوع",
    "nameEn": "Issued and Paid-up Capital",
    "type": "equity",
    "level": 3,
    "parentCode": "310000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "312000000",
    "name": "علاوة إصدار",
    "nameEn": "Share Premium",
    "type": "equity",
    "level": 3,
    "parentCode": "310000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "321000000",
    "name": "الاحتياطي النظامي",
    "nameEn": "Statutory Reserve",
    "type": "equity",
    "level": 3,
    "parentCode": "320000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "322000000",
    "name": "احتياطيات أخرى",
    "nameEn": "Other Reserves",
    "type": "equity",
    "level": 3,
    "parentCode": "320000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "331000000",
    "name": "الأرباح المبقاة",
    "nameEn": "Retained Earnings",
    "type": "equity",
    "level": 3,
    "parentCode": "330000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "332000000",
    "name": "صافي ربح أو خسارة العام",
    "nameEn": "Current Year Profit or Loss",
    "type": "equity",
    "level": 3,
    "parentCode": "330000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "333000000",
    "name": "توزيعات الأرباح والمسحوبات",
    "nameEn": "Dividends and Drawings",
    "type": "equity",
    "level": 3,
    "parentCode": "330000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "411000000",
    "name": "إيرادات المبيعات",
    "nameEn": "Sales Revenue",
    "type": "revenue",
    "level": 3,
    "parentCode": "410000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "412000000",
    "name": "إيرادات الخدمات",
    "nameEn": "Service Revenue",
    "type": "revenue",
    "level": 3,
    "parentCode": "410000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "413000000",
    "name": "مردودات ومسموحات المبيعات",
    "nameEn": "Sales Returns and Allowances",
    "type": "revenue",
    "level": 3,
    "parentCode": "410000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "414000000",
    "name": "خصم المبيعات",
    "nameEn": "Sales Discounts",
    "type": "revenue",
    "level": 3,
    "parentCode": "410000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "421000000",
    "name": "إيرادات عمولات",
    "nameEn": "Commission Income",
    "type": "revenue",
    "level": 3,
    "parentCode": "420000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "422000000",
    "name": "إيرادات تأجير",
    "nameEn": "Rental Income",
    "type": "revenue",
    "level": 3,
    "parentCode": "420000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "423000000",
    "name": "إيرادات تشغيلية أخرى",
    "nameEn": "Other Operating Income",
    "type": "revenue",
    "level": 3,
    "parentCode": "420000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "431000000",
    "name": "إيرادات تمويل وفوائد",
    "nameEn": "Finance and Interest Income",
    "type": "revenue",
    "level": 3,
    "parentCode": "430000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "432000000",
    "name": "أرباح فروق عملة",
    "nameEn": "Foreign Exchange Gains",
    "type": "revenue",
    "level": 3,
    "parentCode": "430000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "433000000",
    "name": "أرباح بيع أصول",
    "nameEn": "Gain on Disposal of Assets",
    "type": "revenue",
    "level": 3,
    "parentCode": "430000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "434000000",
    "name": "عكس مخصصات",
    "nameEn": "Reversal of Provisions",
    "type": "revenue",
    "level": 3,
    "parentCode": "430000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "435000000",
    "name": "إيرادات غير تشغيلية أخرى",
    "nameEn": "Other Non-operating Income",
    "type": "revenue",
    "level": 3,
    "parentCode": "430000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "511000000",
    "name": "تكلفة البضاعة المباعة",
    "nameEn": "Cost of Goods Sold",
    "type": "expense",
    "level": 3,
    "parentCode": "510000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "512000000",
    "name": "مواد مباشرة",
    "nameEn": "Direct Materials",
    "type": "expense",
    "level": 3,
    "parentCode": "510000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "513000000",
    "name": "أجور مباشرة",
    "nameEn": "Direct Labor",
    "type": "expense",
    "level": 3,
    "parentCode": "510000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "514000000",
    "name": "خدمات ومقاولون من الباطن مباشرون",
    "nameEn": "Direct Services and Subcontractors",
    "type": "expense",
    "level": 3,
    "parentCode": "510000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "515000000",
    "name": "شحن ومناولة مشتريات",
    "nameEn": "Freight-in and Purchase Handling",
    "type": "expense",
    "level": 3,
    "parentCode": "510000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "516000000",
    "name": "فروقات وهبوط مخزون",
    "nameEn": "Inventory Adjustments and Write-downs",
    "type": "expense",
    "level": 3,
    "parentCode": "510000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "521000000",
    "name": "رواتب وأجور التشغيل",
    "nameEn": "Operating Salaries and Wages",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "522000000",
    "name": "إيجارات التشغيل",
    "nameEn": "Operating Rent",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "523000000",
    "name": "خدمات ومرافق التشغيل",
    "nameEn": "Operating Utilities",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "524000000",
    "name": "صيانة وإصلاح التشغيل",
    "nameEn": "Operating Repairs and Maintenance",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "525000000",
    "name": "وقود ونقل التشغيل",
    "nameEn": "Operating Fuel and Transportation",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "526000000",
    "name": "مواد ومستلزمات التشغيل",
    "nameEn": "Operating Supplies and Consumables",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "527000000",
    "name": "تأمين التشغيل",
    "nameEn": "Operating Insurance",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "528000000",
    "name": "مصروفات تشغيلية أخرى",
    "nameEn": "Other Operating Expenses",
    "type": "expense",
    "level": 3,
    "parentCode": "520000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "531000000",
    "name": "رواتب وأجور إدارية",
    "nameEn": "Administrative Salaries and Wages",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "532000000",
    "name": "بدلات ومزايا موظفين",
    "nameEn": "Employee Allowances and Benefits",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "533000000",
    "name": "تأمينات اجتماعية",
    "nameEn": "Social Insurance Expense",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "534000000",
    "name": "مكافأة نهاية الخدمة",
    "nameEn": "End-of-service Benefit Expense",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "535000000",
    "name": "إيجارات إدارية",
    "nameEn": "Administrative Rent",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "536000000",
    "name": "كهرباء ومياه ومرافق",
    "nameEn": "Electricity, Water and Utilities",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "537000000",
    "name": "اتصالات وإنترنت",
    "nameEn": "Telecommunications and Internet",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "538000000",
    "name": "أتعاب مهنية واستشارية",
    "nameEn": "Professional and Consulting Fees",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "539000000",
    "name": "رسوم حكومية وتراخيص",
    "nameEn": "Government Fees and Licenses",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "540000000",
    "name": "قرطاسية وطباعة",
    "nameEn": "Stationery and Printing",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "541000000",
    "name": "برامج واشتراكات تقنية",
    "nameEn": "Software and Technology Subscriptions",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "542000000",
    "name": "صيانة وإصلاحات إدارية",
    "nameEn": "Administrative Repairs and Maintenance",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "543000000",
    "name": "تأمين",
    "nameEn": "Insurance Expense",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "544000000",
    "name": "سفر وانتقالات",
    "nameEn": "Travel and Transportation",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "545000000",
    "name": "تدريب وتوظيف",
    "nameEn": "Training and Recruitment",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "546000000",
    "name": "ضيافة واجتماعات",
    "nameEn": "Hospitality and Meetings",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "547000000",
    "name": "رسوم ومصاريف بنكية",
    "nameEn": "Bank Fees and Charges",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "548000000",
    "name": "ديون مشكوك فيها ومعدومة",
    "nameEn": "Expected Credit Loss and Bad Debts",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "549000000",
    "name": "مصروفات عمومية وإدارية أخرى",
    "nameEn": "Other General and Administrative Expenses",
    "type": "expense",
    "level": 3,
    "parentCode": "530000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "551000000",
    "name": "إعلان وتسويق",
    "nameEn": "Advertising and Marketing",
    "type": "expense",
    "level": 3,
    "parentCode": "550000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "552000000",
    "name": "عمولات مبيعات",
    "nameEn": "Sales Commissions",
    "type": "expense",
    "level": 3,
    "parentCode": "550000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "553000000",
    "name": "عروض وفعاليات ترويجية",
    "nameEn": "Promotions and Events",
    "type": "expense",
    "level": 3,
    "parentCode": "550000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "554000000",
    "name": "شحن وتوصيل للعملاء",
    "nameEn": "Outbound Freight and Customer Delivery",
    "type": "expense",
    "level": 3,
    "parentCode": "550000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "555000000",
    "name": "ضيافة وعلاقات عملاء",
    "nameEn": "Customer Hospitality and Relations",
    "type": "expense",
    "level": 3,
    "parentCode": "550000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "556000000",
    "name": "مصروفات بيع وتسويق أخرى",
    "nameEn": "Other Selling and Marketing Expenses",
    "type": "expense",
    "level": 3,
    "parentCode": "550000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "561000000",
    "name": "إهلاك المباني",
    "nameEn": "Depreciation – Buildings",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "562000000",
    "name": "إهلاك تحسينات المباني والمواقع",
    "nameEn": "Depreciation – Leasehold and Site Improvements",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "563000000",
    "name": "إهلاك الآلات والمعدات",
    "nameEn": "Depreciation – Machinery and Equipment",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "564000000",
    "name": "إهلاك المركبات",
    "nameEn": "Depreciation – Vehicles",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "565000000",
    "name": "إهلاك الأثاث والتجهيزات",
    "nameEn": "Depreciation – Furniture and Fixtures",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "566000000",
    "name": "إهلاك أجهزة الحاسب وتقنية المعلومات",
    "nameEn": "Depreciation – Computers and IT Equipment",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "567000000",
    "name": "إهلاك المعدات المكتبية",
    "nameEn": "Depreciation – Office Equipment",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "568000000",
    "name": "إهلاك أصول حق الاستخدام",
    "nameEn": "Depreciation – Right-of-use Assets",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "569000000",
    "name": "إطفاء الأصول غير الملموسة",
    "nameEn": "Amortization – Intangible Assets",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "569500000",
    "name": "إهلاك أصول ثابتة أخرى",
    "nameEn": "Depreciation – Other Fixed Assets",
    "type": "expense",
    "level": 3,
    "parentCode": "560000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "571000000",
    "name": "تكاليف تمويل وفوائد",
    "nameEn": "Finance Costs and Interest",
    "type": "expense",
    "level": 3,
    "parentCode": "570000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "572000000",
    "name": "خسائر فروق عملة",
    "nameEn": "Foreign Exchange Losses",
    "type": "expense",
    "level": 3,
    "parentCode": "570000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "573000000",
    "name": "خسائر بيع أصول",
    "nameEn": "Loss on Disposal of Assets",
    "type": "expense",
    "level": 3,
    "parentCode": "570000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "574000000",
    "name": "غرامات ومخالفات",
    "nameEn": "Fines and Penalties",
    "type": "expense",
    "level": 3,
    "parentCode": "570000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "575000000",
    "name": "خسائر انخفاض قيمة",
    "nameEn": "Impairment Losses",
    "type": "expense",
    "level": 3,
    "parentCode": "570000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "576000000",
    "name": "مصروفات غير تشغيلية أخرى",
    "nameEn": "Other Non-operating Expenses",
    "type": "expense",
    "level": 3,
    "parentCode": "570000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "581000000",
    "name": "مصروف الزكاة",
    "nameEn": "Zakat Expense",
    "type": "expense",
    "level": 3,
    "parentCode": "580000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "582000000",
    "name": "مصروف ضريبة الدخل",
    "nameEn": "Income Tax Expense",
    "type": "expense",
    "level": 3,
    "parentCode": "580000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "583000000",
    "name": "مصروف ضريبة مؤجلة",
    "nameEn": "Deferred Tax Expense",
    "type": "expense",
    "level": 3,
    "parentCode": "580000000",
    "isPosting": false,
    "isBankOrCash": false
  },
  {
    "code": "111000001",
    "name": "النقدية بالصندوق",
    "nameEn": "Cash on Hand",
    "type": "asset",
    "level": 4,
    "parentCode": "111000000",
    "isPosting": true,
    "isBankOrCash": true
  },
  {
    "code": "111000002",
    "name": "العهدة النقدية",
    "nameEn": "Petty Cash",
    "type": "asset",
    "level": 4,
    "parentCode": "111000000",
    "isPosting": true,
    "isBankOrCash": true
  },
  {
    "code": "111000003",
    "name": "الحساب البنكي الرئيسي",
    "nameEn": "Main Bank Account",
    "type": "asset",
    "level": 4,
    "parentCode": "111000000",
    "isPosting": true,
    "isBankOrCash": true
  },
  {
    "code": "111000004",
    "name": "نقدية قيد التحصيل",
    "nameEn": "Cash in Transit",
    "type": "asset",
    "level": 4,
    "parentCode": "111000000",
    "isPosting": true,
    "isBankOrCash": true
  },
  {
    "code": "112000001",
    "name": "العملاء",
    "nameEn": "Trade Customers",
    "type": "asset",
    "level": 4,
    "parentCode": "112000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "112000002",
    "name": "أوراق القبض",
    "nameEn": "Notes Receivable",
    "type": "asset",
    "level": 4,
    "parentCode": "112000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "112000003",
    "name": "مخصص خسائر ائتمانية متوقعة",
    "nameEn": "Allowance for Expected Credit Losses",
    "type": "asset",
    "level": 4,
    "parentCode": "112000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "113000001",
    "name": "سلف الموظفين",
    "nameEn": "Employee Advances",
    "type": "asset",
    "level": 4,
    "parentCode": "113000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "113000002",
    "name": "عهد الموظفين",
    "nameEn": "Employee Custodies",
    "type": "asset",
    "level": 4,
    "parentCode": "113000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "113000003",
    "name": "دفعات مقدمة للموردين",
    "nameEn": "Supplier Advances",
    "type": "asset",
    "level": 4,
    "parentCode": "113000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "113000004",
    "name": "أطراف ذات علاقة مدينة",
    "nameEn": "Due from Related Parties",
    "type": "asset",
    "level": 4,
    "parentCode": "113000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "113000005",
    "name": "تأمينات مستردة قصيرة الأجل",
    "nameEn": "Short-term Refundable Deposits",
    "type": "asset",
    "level": 4,
    "parentCode": "113000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "113000006",
    "name": "أرصدة مدينة أخرى",
    "nameEn": "Other Debit Balances",
    "type": "asset",
    "level": 4,
    "parentCode": "113000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "114000001",
    "name": "مخزون بضائع",
    "nameEn": "Merchandise Inventory",
    "type": "asset",
    "level": 4,
    "parentCode": "114000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "114000002",
    "name": "مخزون مواد خام",
    "nameEn": "Raw Materials Inventory",
    "type": "asset",
    "level": 4,
    "parentCode": "114000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "114000003",
    "name": "إنتاج تحت التشغيل",
    "nameEn": "Work in Progress",
    "type": "asset",
    "level": 4,
    "parentCode": "114000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "114000004",
    "name": "مخزون إنتاج تام",
    "nameEn": "Finished Goods Inventory",
    "type": "asset",
    "level": 4,
    "parentCode": "114000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "114000005",
    "name": "مخزون مواد ومستلزمات",
    "nameEn": "Supplies and Consumables Inventory",
    "type": "asset",
    "level": 4,
    "parentCode": "114000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "114000006",
    "name": "مخصص هبوط مخزون",
    "nameEn": "Inventory Obsolescence Allowance",
    "type": "asset",
    "level": 4,
    "parentCode": "114000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "115000001",
    "name": "إيجار مدفوع مقدماً",
    "nameEn": "Prepaid Rent",
    "type": "asset",
    "level": 4,
    "parentCode": "115000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "115000002",
    "name": "تأمين مدفوع مقدماً",
    "nameEn": "Prepaid Insurance",
    "type": "asset",
    "level": 4,
    "parentCode": "115000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "115000003",
    "name": "اشتراكات مدفوعة مقدماً",
    "nameEn": "Prepaid Subscriptions",
    "type": "asset",
    "level": 4,
    "parentCode": "115000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "115000004",
    "name": "مصروفات مدفوعة مقدماً أخرى",
    "nameEn": "Other Prepaid Expenses",
    "type": "asset",
    "level": 4,
    "parentCode": "115000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "116000001",
    "name": "ضريبة القيمة المضافة على المدخلات",
    "nameEn": "Input VAT",
    "type": "asset",
    "level": 4,
    "parentCode": "116000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "116000002",
    "name": "ضريبة استقطاع مستردة",
    "nameEn": "Recoverable Withholding Tax",
    "type": "asset",
    "level": 4,
    "parentCode": "116000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "116000003",
    "name": "ضرائب ورسوم مستردة أخرى",
    "nameEn": "Other Recoverable Taxes",
    "type": "asset",
    "level": 4,
    "parentCode": "116000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "121000001",
    "name": "استثمارات طويلة الأجل",
    "nameEn": "Long-term Investments",
    "type": "asset",
    "level": 4,
    "parentCode": "121000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "122000001",
    "name": "تأمينات مستردة طويلة الأجل",
    "nameEn": "Long-term Refundable Deposits",
    "type": "asset",
    "level": 4,
    "parentCode": "122000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "122000002",
    "name": "ذمم مدينة طويلة الأجل",
    "nameEn": "Long-term Receivables",
    "type": "asset",
    "level": 4,
    "parentCode": "122000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "123000001",
    "name": "أصول حق الاستخدام",
    "nameEn": "Right-of-use Assets",
    "type": "asset",
    "level": 4,
    "parentCode": "123000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "123000002",
    "name": "مجمع إهلاك أصول حق الاستخدام",
    "nameEn": "Accumulated Depreciation – Right-of-use Assets",
    "type": "asset",
    "level": 4,
    "parentCode": "123000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "124000001",
    "name": "برامج وأنظمة",
    "nameEn": "Software and Systems",
    "type": "asset",
    "level": 4,
    "parentCode": "124000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "124000002",
    "name": "تراخيص وحقوق",
    "nameEn": "Licenses and Rights",
    "type": "asset",
    "level": 4,
    "parentCode": "124000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "124000003",
    "name": "شهرة",
    "nameEn": "Goodwill",
    "type": "asset",
    "level": 4,
    "parentCode": "124000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "124000004",
    "name": "مجمع إطفاء الأصول غير الملموسة",
    "nameEn": "Accumulated Amortization – Intangible Assets",
    "type": "asset",
    "level": 4,
    "parentCode": "124000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "131000001",
    "name": "تكلفة الأراضي",
    "nameEn": "Land – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "131000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "132000001",
    "name": "تكلفة المباني",
    "nameEn": "Buildings – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "132000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "132000002",
    "name": "مجمع إهلاك المباني",
    "nameEn": "Accumulated Depreciation – Buildings",
    "type": "asset",
    "level": 4,
    "parentCode": "132000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "133000001",
    "name": "تكلفة تحسينات المباني والمواقع",
    "nameEn": "Leasehold and Site Improvements – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "133000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "133000002",
    "name": "مجمع إهلاك تحسينات المباني والمواقع",
    "nameEn": "Accumulated Depreciation – Leasehold and Site Improvements",
    "type": "asset",
    "level": 4,
    "parentCode": "133000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "134000001",
    "name": "تكلفة الآلات والمعدات",
    "nameEn": "Machinery and Equipment – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "134000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "134000002",
    "name": "مجمع إهلاك الآلات والمعدات",
    "nameEn": "Accumulated Depreciation – Machinery and Equipment",
    "type": "asset",
    "level": 4,
    "parentCode": "134000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "135000001",
    "name": "تكلفة المركبات",
    "nameEn": "Vehicles – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "135000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "135000002",
    "name": "مجمع إهلاك المركبات",
    "nameEn": "Accumulated Depreciation – Vehicles",
    "type": "asset",
    "level": 4,
    "parentCode": "135000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "136000001",
    "name": "تكلفة الأثاث والتجهيزات",
    "nameEn": "Furniture and Fixtures – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "136000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "136000002",
    "name": "مجمع إهلاك الأثاث والتجهيزات",
    "nameEn": "Accumulated Depreciation – Furniture and Fixtures",
    "type": "asset",
    "level": 4,
    "parentCode": "136000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "137000001",
    "name": "تكلفة أجهزة الحاسب وتقنية المعلومات",
    "nameEn": "Computers and IT Equipment – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "137000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "137000002",
    "name": "مجمع إهلاك أجهزة الحاسب وتقنية المعلومات",
    "nameEn": "Accumulated Depreciation – Computers and IT Equipment",
    "type": "asset",
    "level": 4,
    "parentCode": "137000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "138000001",
    "name": "تكلفة المعدات المكتبية",
    "nameEn": "Office Equipment – Cost",
    "type": "asset",
    "level": 4,
    "parentCode": "138000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "138000002",
    "name": "مجمع إهلاك المعدات المكتبية",
    "nameEn": "Accumulated Depreciation – Office Equipment",
    "type": "asset",
    "level": 4,
    "parentCode": "138000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "138000003",
    "name": "أصول ثابتة أخرى",
    "nameEn": "Other Fixed Assets",
    "type": "asset",
    "level": 4,
    "parentCode": "138000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "138000004",
    "name": "مجمع إهلاك أصول ثابتة أخرى",
    "nameEn": "Accumulated Depreciation – Other Fixed Assets",
    "type": "asset",
    "level": 4,
    "parentCode": "138000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "139000001",
    "name": "مشروعات رأسمالية تحت التنفيذ",
    "nameEn": "Capital Work in Progress",
    "type": "asset",
    "level": 4,
    "parentCode": "139000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "211000001",
    "name": "الموردون",
    "nameEn": "Trade Suppliers",
    "type": "liability",
    "level": 4,
    "parentCode": "211000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "211000002",
    "name": "أوراق الدفع",
    "nameEn": "Notes Payable",
    "type": "liability",
    "level": 4,
    "parentCode": "211000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "212000001",
    "name": "رواتب وأجور مستحقة",
    "nameEn": "Accrued Salaries and Wages",
    "type": "liability",
    "level": 4,
    "parentCode": "212000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "212000002",
    "name": "إيجارات مستحقة",
    "nameEn": "Accrued Rent",
    "type": "liability",
    "level": 4,
    "parentCode": "212000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "212000003",
    "name": "خدمات ومرافق مستحقة",
    "nameEn": "Accrued Utilities",
    "type": "liability",
    "level": 4,
    "parentCode": "212000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "212000004",
    "name": "أتعاب مهنية مستحقة",
    "nameEn": "Accrued Professional Fees",
    "type": "liability",
    "level": 4,
    "parentCode": "212000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "212000005",
    "name": "مصروفات مستحقة أخرى",
    "nameEn": "Other Accrued Expenses",
    "type": "liability",
    "level": 4,
    "parentCode": "212000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "213000001",
    "name": "ضريبة القيمة المضافة على المخرجات",
    "nameEn": "Output VAT",
    "type": "liability",
    "level": 4,
    "parentCode": "213000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "213000002",
    "name": "ضريبة القيمة المضافة المستحقة",
    "nameEn": "VAT Payable",
    "type": "liability",
    "level": 4,
    "parentCode": "213000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "213000003",
    "name": "زكاة وضريبة دخل مستحقة",
    "nameEn": "Zakat and Income Tax Payable",
    "type": "liability",
    "level": 4,
    "parentCode": "213000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "213000004",
    "name": "ضريبة استقطاع مستحقة",
    "nameEn": "Withholding Tax Payable",
    "type": "liability",
    "level": 4,
    "parentCode": "213000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "214000001",
    "name": "مستحقات الموظفين",
    "nameEn": "Employee Payables",
    "type": "liability",
    "level": 4,
    "parentCode": "214000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "214000002",
    "name": "تأمينات اجتماعية مستحقة",
    "nameEn": "Social Insurance Payable",
    "type": "liability",
    "level": 4,
    "parentCode": "214000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "215000001",
    "name": "دفعات مقدمة من العملاء",
    "nameEn": "Advances from Customers",
    "type": "liability",
    "level": 4,
    "parentCode": "215000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "215000002",
    "name": "إيرادات مؤجلة",
    "nameEn": "Deferred Revenue",
    "type": "liability",
    "level": 4,
    "parentCode": "215000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "216000001",
    "name": "الجزء المتداول من القروض",
    "nameEn": "Current Portion of Loans",
    "type": "liability",
    "level": 4,
    "parentCode": "216000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "216000002",
    "name": "التزامات إيجار متداولة",
    "nameEn": "Current Lease Liabilities",
    "type": "liability",
    "level": 4,
    "parentCode": "216000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "217000001",
    "name": "أطراف ذات علاقة دائنة",
    "nameEn": "Due to Related Parties",
    "type": "liability",
    "level": 4,
    "parentCode": "217000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "217000002",
    "name": "توزيعات أرباح مستحقة",
    "nameEn": "Dividends Payable",
    "type": "liability",
    "level": 4,
    "parentCode": "217000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "217000003",
    "name": "أرصدة دائنة أخرى",
    "nameEn": "Other Credit Balances",
    "type": "liability",
    "level": 4,
    "parentCode": "217000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "221000001",
    "name": "قروض طويلة الأجل",
    "nameEn": "Long-term Loans",
    "type": "liability",
    "level": 4,
    "parentCode": "221000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "222000001",
    "name": "التزامات إيجار غير متداولة",
    "nameEn": "Non-current Lease Liabilities",
    "type": "liability",
    "level": 4,
    "parentCode": "222000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "223000001",
    "name": "مخصص مكافأة نهاية الخدمة",
    "nameEn": "End-of-service Benefit Provision",
    "type": "liability",
    "level": 4,
    "parentCode": "223000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "223000002",
    "name": "مخصصات أخرى",
    "nameEn": "Other Provisions",
    "type": "liability",
    "level": 4,
    "parentCode": "223000000",
    "isPosting": true,
    "isBankOrCash": false
  },
  {
    "code": "224000001",
    "name": "التزام ضريبة مؤجلة",
    "nameEn": "Deferred Tax Liability",
    "type": "liability",
    "level": 4,
    "parentCode": "224000000",
    "isPosting": true,
    "isBankOrCash": false
  }
];

export async function createDefaultChart(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string | null,
) {
  const createdByCode = new Map<string, { id: string }>();
  for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
    const parent = account.parentCode ? createdByCode.get(account.parentCode) : null;
    if (account.parentCode && !parent) {
      throw new Error(`الحساب الأب ${account.parentCode} غير موجود عند إنشاء القالب الافتراضي`);
    }
    const created = await tx.account.create({
      data: {
        tenantId,
        companyId,
        parentId: parent?.id || null,
        code: account.code,
        level: account.level,
        isPosting: account.isPosting,
        name: account.name,
        nameEn: account.nameEn,
        type: account.type,
        isBankOrCash: account.isBankOrCash || false,
      },
      select: { id: true },
    });
    createdByCode.set(account.code, created);
  }
}
