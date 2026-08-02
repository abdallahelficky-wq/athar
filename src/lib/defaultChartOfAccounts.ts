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
  "code": "1101",
  "name": "النقدية وما يعادلها",
  "nameEn": "Cash and Cash Equivalents",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "110101",
  "name": "النقدية بالصندوق",
  "nameEn": "Cash on Hand",
  "type": "asset",
  "level": 4,
  "parentCode": "1101",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "110102",
  "name": "عهدة نقدية",
  "nameEn": "Cash Custody / Petty Cash Advances",
  "type": "asset",
  "level": 4,
  "parentCode": "1101",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "110103",
  "name": "مصرف الراجحي",
  "nameEn": "Al Rajhi Bank",
  "type": "asset",
  "level": 4,
  "parentCode": "1101",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "110104",
  "name": "البنك السعودي الأول (ساب)",
  "nameEn": "Saudi Awwal Bank (SAB)",
  "type": "asset",
  "level": 4,
  "parentCode": "1101",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "110105",
  "name": "مصرف الإنماء",
  "nameEn": "Alinma Bank",
  "type": "asset",
  "level": 4,
  "parentCode": "1101",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "110106",
  "name": "نقدية قيد التحصيل",
  "nameEn": "Cash in Transit / Uncleared Deposits",
  "type": "asset",
  "level": 4,
  "parentCode": "1101",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "1102",
  "name": "العملاء والذمم المدينة التجارية",
  "nameEn": "Trade Receivables",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "110201",
  "name": "العملاء",
  "nameEn": "Accounts Receivable - Customers",
  "type": "asset",
  "level": 4,
  "parentCode": "1102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110202",
  "name": "أوراق القبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "1102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110203",
  "name": "مخصص الديون المشكوك في تحصيلها",
  "nameEn": "Allowance for Doubtful Debts",
  "type": "asset",
  "level": 4,
  "parentCode": "1102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1103",
  "name": "ذمم مدينة أخرى وسلف وعهد",
  "nameEn": "Other Receivables, Advances and Custodies",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "110301",
  "name": "سلف الموظفين",
  "nameEn": "Employee Advances",
  "type": "asset",
  "level": 4,
  "parentCode": "1103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110302",
  "name": "عهد الموظفين",
  "nameEn": "Employee Custodies",
  "type": "asset",
  "level": 4,
  "parentCode": "1103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110303",
  "name": "دفعات مقدمة للموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "1103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110304",
  "name": "أطراف ذات علاقة مدينة",
  "nameEn": "Related Parties - Debit",
  "type": "asset",
  "level": 4,
  "parentCode": "1103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110305",
  "name": "ذمم بين الشركات الشقيقة - مدينة",
  "nameEn": "Intercompany Receivables - Sister Companies",
  "type": "asset",
  "level": 4,
  "parentCode": "1103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110306",
  "name": "أرصدة مدينة أخرى",
  "nameEn": "Other Debit Balances",
  "type": "asset",
  "level": 4,
  "parentCode": "1103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1104",
  "name": "المخزون",
  "nameEn": "Inventory",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "110401",
  "name": "مخزون بضائع",
  "nameEn": "Merchandise Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110402",
  "name": "مخزون مواد خام",
  "nameEn": "Raw Materials Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110403",
  "name": "مخزون قطع الغيار",
  "nameEn": "Spare Parts Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110404",
  "name": "مخزون الوقود والمحروقات",
  "nameEn": "Fuel Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110405",
  "name": "إنتاج تحت التشغيل",
  "nameEn": "Work in Progress",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110406",
  "name": "مخزون إنتاج تام",
  "nameEn": "Finished Goods Inventory",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110407",
  "name": "مخصص إهلاك المخزون",
  "nameEn": "Inventory Obsolescence Provision",
  "type": "asset",
  "level": 4,
  "parentCode": "1104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1105",
  "name": "مصروفات مدفوعة مقدماً وضرائب مستردة",
  "nameEn": "Prepaid Expenses and Recoverable Taxes",
  "type": "asset",
  "level": 3,
  "parentCode": "11",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "110501",
  "name": "إيجار مدفوع مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "1105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110502",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "1105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110503",
  "name": "اشتراكات مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions",
  "type": "asset",
  "level": 4,
  "parentCode": "1105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110504",
  "name": "ضريبة القيمة المضافة على المدخلات",
  "nameEn": "VAT Input",
  "type": "asset",
  "level": 4,
  "parentCode": "1105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "110505",
  "name": "مصروفات مدفوعة مقدماً أخرى",
  "nameEn": "Other Prepaid Expenses",
  "type": "asset",
  "level": 4,
  "parentCode": "1105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "12",
  "name": "الأصول الثابتة",
  "nameEn": "Fixed Assets",
  "type": "asset",
  "level": 2,
  "parentCode": "1",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "1201",
  "name": "أراضي ومباني",
  "nameEn": "Land and Buildings",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "120101",
  "name": "تكلفة الأراضي",
  "nameEn": "Cost of Land",
  "type": "asset",
  "level": 4,
  "parentCode": "1201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120102",
  "name": "تكلفة المباني",
  "nameEn": "Cost of Buildings",
  "type": "asset",
  "level": 4,
  "parentCode": "1201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1202",
  "name": "سيارات ومعدات النقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "120201",
  "name": "تكلفة السيارات ومعدات النقل",
  "nameEn": "Cost of Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "1202",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1203",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "120301",
  "name": "تكلفة الآلات والمعدات",
  "nameEn": "Cost of Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "1203",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1204",
  "name": "أثاث وتجهيزات وأجهزة حاسب آلي",
  "nameEn": "Furniture, Fixtures and IT Equipment",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "120401",
  "name": "تكلفة الأثاث والتجهيزات المكتبية",
  "nameEn": "Cost of Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "1204",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120402",
  "name": "تكلفة أجهزة الحاسب الآلي وتقنية المعلومات",
  "nameEn": "Cost of Computers and IT Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "1204",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1205",
  "name": "مجمّع الإهلاك",
  "nameEn": "Accumulated Depreciation",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "120501",
  "name": "مجمّع إهلاك المباني",
  "nameEn": "Accumulated Depreciation - Buildings",
  "type": "asset",
  "level": 4,
  "parentCode": "1205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120502",
  "name": "مجمّع إهلاك السيارات ومعدات النقل",
  "nameEn": "Accumulated Depreciation - Vehicles",
  "type": "asset",
  "level": 4,
  "parentCode": "1205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120503",
  "name": "مجمّع إهلاك الآلات والمعدات",
  "nameEn": "Accumulated Depreciation - Machinery",
  "type": "asset",
  "level": 4,
  "parentCode": "1205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120504",
  "name": "مجمّع إهلاك الأثاث والتجهيزات المكتبية",
  "nameEn": "Accumulated Depreciation - Furniture",
  "type": "asset",
  "level": 4,
  "parentCode": "1205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120505",
  "name": "مجمّع إهلاك أجهزة الحاسب الآلي",
  "nameEn": "Accumulated Depreciation - Computers",
  "type": "asset",
  "level": 4,
  "parentCode": "1205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "120506",
  "name": "مجمع إهلاك أصول ثابتة أخرى",
  "nameEn": "Accumulated Depreciation - Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "1205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "1206",
  "name": "الأصول الثابتة الأخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 3,
  "parentCode": "12",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "120601",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "1206",
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
  "code": "2101",
  "name": "الموردون وأوراق الدفع",
  "nameEn": "Suppliers and Notes Payable",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "210101",
  "name": "الموردون",
  "nameEn": "Accounts Payable - Suppliers",
  "type": "liability",
  "level": 4,
  "parentCode": "2101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210102",
  "name": "أوراق الدفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "2101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2102",
  "name": "مصروفات مستحقة",
  "nameEn": "Accrued Expenses",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "210201",
  "name": "رواتب وأجور مستحقة",
  "nameEn": "Accrued Salaries and Wages",
  "type": "liability",
  "level": 4,
  "parentCode": "2102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210202",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "2102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210203",
  "name": "خدمات ومرافق مستحقة",
  "nameEn": "Accrued Utilities",
  "type": "liability",
  "level": 4,
  "parentCode": "2102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210204",
  "name": "أتعاب مهنية مستحقة",
  "nameEn": "Accrued Professional Fees",
  "type": "liability",
  "level": 4,
  "parentCode": "2102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210205",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "2102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210206",
  "name": "مستحقات الموظفين",
  "nameEn": "Employee Dues and Entitlements",
  "type": "liability",
  "level": 4,
  "parentCode": "2102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2103",
  "name": "ضرائب وزكاة مستحقة",
  "nameEn": "Taxes and Zakat Payable",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "210301",
  "name": "ضريبة القيمة المضافة على المخرجات",
  "nameEn": "VAT Output",
  "type": "liability",
  "level": 4,
  "parentCode": "2103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210302",
  "name": "ضريبة القيمة المضافة المستحقة",
  "nameEn": "VAT Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "2103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210303",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "2103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210304",
  "name": "مخصص الزكاة",
  "nameEn": "Zakat Provision",
  "type": "liability",
  "level": 4,
  "parentCode": "2103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210305",
  "name": "ضريبة الدخل المستحقة",
  "nameEn": "Income Tax Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "2103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210306",
  "name": "ضريبة الاستقطاع المستحقة",
  "nameEn": "Withholding Tax Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "2103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2104",
  "name": "ذمم دائنة أخرى وحسابات بين الشركات",
  "nameEn": "Other Payables and Intercompany Accounts",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "210401",
  "name": "دفعات مقدمة من العملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "2104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210402",
  "name": "ذمم بين الشركات الشقيقة - دائنة",
  "nameEn": "Intercompany Payables - Sister Companies",
  "type": "liability",
  "level": 4,
  "parentCode": "2104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210403",
  "name": "توزيعات أرباح مستحقة",
  "nameEn": "Dividends Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "2104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "210404",
  "name": "أرصدة دائنة أخرى",
  "nameEn": "Other Credit Balances",
  "type": "liability",
  "level": 4,
  "parentCode": "2104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2105",
  "name": "الجزء المتداول من القروض",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "210501",
  "name": "الجزء المتداول من القروض طويلة الأجل",
  "nameEn": "Current Portion of Long-Term Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "2105",
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
  "code": "2201",
  "name": "قروض طويلة الأجل",
  "nameEn": "Long-Term Loans",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "220101",
  "name": "قروض بنكية طويلة الأجل",
  "nameEn": "Long-Term Bank Loans",
  "type": "liability",
  "level": 4,
  "parentCode": "2201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "2202",
  "name": "مخصصات طويلة الأجل",
  "nameEn": "Long-Term Provisions",
  "type": "liability",
  "level": 3,
  "parentCode": "22",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "220201",
  "name": "مخصص مكافأة نهاية الخدمة",
  "nameEn": "End of Service Benefits Provision",
  "type": "liability",
  "level": 4,
  "parentCode": "2202",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "220202",
  "name": "مخصصات طويلة الأجل أخرى",
  "nameEn": "Other Long-Term Provisions",
  "type": "liability",
  "level": 4,
  "parentCode": "2202",
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
  "name": "رأس المال والاحتياطيات",
  "nameEn": "Capital and Reserves",
  "type": "equity",
  "level": 2,
  "parentCode": "3",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "3101",
  "name": "رأس المال",
  "nameEn": "Share Capital",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "310101",
  "name": "رأس المال المصدر والمدفوع",
  "nameEn": "Issued and Paid-up Capital",
  "type": "equity",
  "level": 4,
  "parentCode": "3101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "310102",
  "name": "علاوة إصدار",
  "nameEn": "Share Premium",
  "type": "equity",
  "level": 4,
  "parentCode": "3101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3102",
  "name": "الاحتياطيات",
  "nameEn": "Reserves",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "310201",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "3102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "310202",
  "name": "احتياطيات أخرى",
  "nameEn": "Other Reserves",
  "type": "equity",
  "level": 4,
  "parentCode": "3102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "3103",
  "name": "الأرباح المبقاة وصافي الربح",
  "nameEn": "Retained Earnings and Net Income",
  "type": "equity",
  "level": 3,
  "parentCode": "31",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "310301",
  "name": "الأرباح المبقاة",
  "nameEn": "Retained Earnings",
  "type": "equity",
  "level": 4,
  "parentCode": "3103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "310302",
  "name": "صافي ربح أو خسارة العام",
  "nameEn": "Net Income / Loss for the Year",
  "type": "equity",
  "level": 4,
  "parentCode": "3103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "310303",
  "name": "توزيعات الأرباح والمسحوبات",
  "nameEn": "Dividends and Drawings",
  "type": "equity",
  "level": 4,
  "parentCode": "3103",
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
  "name": "إيرادات التشغيل",
  "nameEn": "Operating Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4101",
  "name": "إيرادات المبيعات والخدمات",
  "nameEn": "Sales and Service Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "410101",
  "name": "إيرادات المبيعات",
  "nameEn": "Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "4101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "410102",
  "name": "إيرادات الخدمات",
  "nameEn": "Service Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "4101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "410103",
  "name": "مردودات ومسموحات المبيعات",
  "nameEn": "Sales Returns and Allowances",
  "type": "revenue",
  "level": 4,
  "parentCode": "4101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "410104",
  "name": "خصم المبيعات المسموح به",
  "nameEn": "Sales Discounts Allowed",
  "type": "revenue",
  "level": 4,
  "parentCode": "4101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "4102",
  "name": "إيرادات عمولات وتأجير",
  "nameEn": "Commission and Rental Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "41",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "410201",
  "name": "إيرادات عمولات",
  "nameEn": "Commission Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "4102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "410202",
  "name": "إيرادات تأجير",
  "nameEn": "Rental Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "4102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "42",
  "name": "إيرادات أخرى",
  "nameEn": "Other Revenue",
  "type": "revenue",
  "level": 2,
  "parentCode": "4",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "4201",
  "name": "إيرادات غير تشغيلية",
  "nameEn": "Non-Operating Revenue",
  "type": "revenue",
  "level": 3,
  "parentCode": "42",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "420101",
  "name": "إيرادات تمويل وفوائد",
  "nameEn": "Financing and Interest Income",
  "type": "revenue",
  "level": 4,
  "parentCode": "4201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "420102",
  "name": "أرباح فروق عملة",
  "nameEn": "Foreign Exchange Gains",
  "type": "revenue",
  "level": 4,
  "parentCode": "4201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "420103",
  "name": "أرباح بيع أصول",
  "nameEn": "Gain on Disposal of Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "4201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "420104",
  "name": "عكس مخصصات",
  "nameEn": "Reversal of Provisions",
  "type": "revenue",
  "level": 4,
  "parentCode": "4201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "420105",
  "name": "إيرادات غير تشغيلية أخرى",
  "nameEn": "Other Non-Operating Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "4201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5",
  "name": "المصروفات",
  "nameEn": "Expenses",
  "type": "expense",
  "level": 1,
  "parentCode": null,
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "51",
  "name": "مصروفات التشغيل",
  "nameEn": "Operating Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5101",
  "name": "تكلفة البضاعة المباعة والمواد المباشرة",
  "nameEn": "Cost of Goods Sold and Direct Materials",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "510101",
  "name": "تكلفة البضاعة المباعة",
  "nameEn": "Cost of Goods Sold",
  "type": "expense",
  "level": 4,
  "parentCode": "5101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510102",
  "name": "مواد مباشرة مستهلكة",
  "nameEn": "Direct Materials Consumed",
  "type": "expense",
  "level": 4,
  "parentCode": "5101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510103",
  "name": "أجور مباشرة",
  "nameEn": "Direct Labor",
  "type": "expense",
  "level": 4,
  "parentCode": "5101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510104",
  "name": "خدمات مقاولين من الباطن مباشرة",
  "nameEn": "Direct Subcontractor Services",
  "type": "expense",
  "level": 4,
  "parentCode": "5101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510105",
  "name": "شحن ومناولة مشتريات",
  "nameEn": "Freight and Handling on Purchases",
  "type": "expense",
  "level": 4,
  "parentCode": "5101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510106",
  "name": "فروقات وهبوط مخزون",
  "nameEn": "Inventory Adjustments and Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "5101",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5102",
  "name": "رواتب وأجور ومزايا التشغيل",
  "nameEn": "Operating Payroll and Benefits",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "510201",
  "name": "رواتب وأجور التشغيل",
  "nameEn": "Operating Salaries and Wages",
  "type": "expense",
  "level": 4,
  "parentCode": "5102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510202",
  "name": "بدلات ومزايا موظفي التشغيل",
  "nameEn": "Operating Staff Allowances and Benefits",
  "type": "expense",
  "level": 4,
  "parentCode": "5102",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5103",
  "name": "إيجارات ومرافق التشغيل",
  "nameEn": "Operating Rent and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "510301",
  "name": "إيجار محطات ومواقع",
  "nameEn": "Rent of Stations and Sites",
  "type": "expense",
  "level": 4,
  "parentCode": "5103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510302",
  "name": "كهرباء ومياه التشغيل",
  "nameEn": "Operating Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "5103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510303",
  "name": "اتصالات التشغيل",
  "nameEn": "Operating Telecommunications",
  "type": "expense",
  "level": 4,
  "parentCode": "5103",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5104",
  "name": "صيانة ووقود التشغيل",
  "nameEn": "Operating Maintenance and Fuel",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "510401",
  "name": "صيانة سيارات - تشغيل",
  "nameEn": "Vehicle Maintenance - Operating",
  "type": "expense",
  "level": 4,
  "parentCode": "5104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510402",
  "name": "صيانة معدات - تشغيل",
  "nameEn": "Equipment Maintenance - Operating",
  "type": "expense",
  "level": 4,
  "parentCode": "5104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510403",
  "name": "وقود ومحروقات تشغيلية",
  "nameEn": "Operating Fuel",
  "type": "expense",
  "level": 4,
  "parentCode": "5104",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5105",
  "name": "مصروفات تشغيلية أخرى",
  "nameEn": "Other Operating Expenses",
  "type": "expense",
  "level": 3,
  "parentCode": "51",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "510501",
  "name": "مواد ومستلزمات التشغيل",
  "nameEn": "Operating Materials and Supplies",
  "type": "expense",
  "level": 4,
  "parentCode": "5105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510502",
  "name": "تأمين التشغيل",
  "nameEn": "Operating Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "5105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "510503",
  "name": "مصروفات تشغيلية متنوعة",
  "nameEn": "Miscellaneous Operating Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "5105",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "52",
  "name": "المصروفات الإدارية والعمومية",
  "nameEn": "General and Administrative Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5201",
  "name": "رواتب وأجور ومزايا إدارية",
  "nameEn": "Administrative Payroll and Benefits",
  "type": "expense",
  "level": 3,
  "parentCode": "52",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "520101",
  "name": "رواتب وأجور إدارية",
  "nameEn": "Administrative Salaries and Wages",
  "type": "expense",
  "level": 4,
  "parentCode": "5201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520102",
  "name": "بدلات ومزايا موظفين",
  "nameEn": "Staff Allowances and Benefits",
  "type": "expense",
  "level": 4,
  "parentCode": "5201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520103",
  "name": "اشتراكات التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance Contributions (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "5201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520104",
  "name": "تأمين طبي للموظفين",
  "nameEn": "Employee Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "5201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520105",
  "name": "مكافأة نهاية الخدمة (مصروف السنة)",
  "nameEn": "End of Service Benefits Expense",
  "type": "expense",
  "level": 4,
  "parentCode": "5201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520106",
  "name": "تدريب وتوظيف",
  "nameEn": "Training and Recruitment",
  "type": "expense",
  "level": 4,
  "parentCode": "5201",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5202",
  "name": "إيجارات ومرافق إدارية",
  "nameEn": "Administrative Rent and Utilities",
  "type": "expense",
  "level": 3,
  "parentCode": "52",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "520201",
  "name": "إيجارات المكاتب الإدارية",
  "nameEn": "Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "5202",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520202",
  "name": "كهرباء ومياه إدارية",
  "nameEn": "Administrative Electricity and Water",
  "type": "expense",
  "level": 4,
  "parentCode": "5202",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520203",
  "name": "اتصالات وإنترنت إدارية",
  "nameEn": "Administrative Telecom and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "5202",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5203",
  "name": "أتعاب مهنية ورسوم حكومية",
  "nameEn": "Professional Fees and Government Charges",
  "type": "expense",
  "level": 3,
  "parentCode": "52",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "520301",
  "name": "أتعاب مراجعة حسابات",
  "nameEn": "Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "5203",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520302",
  "name": "أتعاب استشارية وقانونية",
  "nameEn": "Consulting and Legal Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "5203",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520303",
  "name": "رسوم حكومية وتراخيص",
  "nameEn": "Government Fees and Licenses",
  "type": "expense",
  "level": 4,
  "parentCode": "5203",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5204",
  "name": "التسويق والإعلان",
  "nameEn": "Marketing and Advertising",
  "type": "expense",
  "level": 3,
  "parentCode": "52",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "520401",
  "name": "إعلان وتسويق",
  "nameEn": "Advertising and Marketing",
  "type": "expense",
  "level": 4,
  "parentCode": "5204",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520402",
  "name": "عمولات مبيعات",
  "nameEn": "Sales Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "5204",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520403",
  "name": "ضيافة وعلاقات عملاء",
  "nameEn": "Hospitality and Customer Relations",
  "type": "expense",
  "level": 4,
  "parentCode": "5204",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5205",
  "name": "الإهلاك والإطفاء",
  "nameEn": "Depreciation and Amortization",
  "type": "expense",
  "level": 3,
  "parentCode": "52",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "520501",
  "name": "إهلاك المباني",
  "nameEn": "Depreciation - Buildings",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520502",
  "name": "إهلاك السيارات ومعدات النقل",
  "nameEn": "Depreciation - Vehicles",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520503",
  "name": "إهلاك الآلات والمعدات",
  "nameEn": "Depreciation - Machinery",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520504",
  "name": "إهلاك الأثاث والتجهيزات المكتبية",
  "nameEn": "Depreciation - Furniture",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520505",
  "name": "إهلاك أجهزة الحاسب الآلي",
  "nameEn": "Depreciation - Computers",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520506",
  "name": "إطفاء الأصول غير الملموسة",
  "nameEn": "Amortization of Intangible Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520507",
  "name": "إهلاك أصول ثابتة أخرى",
  "nameEn": "Depreciation - Other Fixed Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "5205",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5206",
  "name": "مصروفات إدارية أخرى ومخصصات",
  "nameEn": "Other Administrative Expenses and Provisions",
  "type": "expense",
  "level": 3,
  "parentCode": "52",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "520601",
  "name": "قرطاسية وطباعة",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520602",
  "name": "برامج واشتراكات تقنية",
  "nameEn": "Software and IT Subscriptions",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520603",
  "name": "صيانة إدارية",
  "nameEn": "Administrative Maintenance",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520604",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520605",
  "name": "مصروف الديون المشكوك في تحصيلها",
  "nameEn": "Doubtful Debts Expense",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520606",
  "name": "مصروف مخصص إهلاك المخزون",
  "nameEn": "Inventory Obsolescence Expense",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "520607",
  "name": "مصروفات إدارية وعمومية أخرى",
  "nameEn": "Other General and Administrative Expenses",
  "type": "expense",
  "level": 4,
  "parentCode": "5206",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "53",
  "name": "المصروفات المالية",
  "nameEn": "Financial Expenses",
  "type": "expense",
  "level": 2,
  "parentCode": "5",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "5301",
  "name": "فوائد وعمولات بنكية",
  "nameEn": "Bank Interest and Commissions",
  "type": "expense",
  "level": 3,
  "parentCode": "53",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "530101",
  "name": "فوائد وتكاليف تمويل",
  "nameEn": "Financing Interest and Costs",
  "type": "expense",
  "level": 4,
  "parentCode": "5301",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "530102",
  "name": "رسوم وعمولات بنكية",
  "nameEn": "Bank Fees and Commissions",
  "type": "expense",
  "level": 4,
  "parentCode": "5301",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "530103",
  "name": "خسائر فروق عملة",
  "nameEn": "Foreign Exchange Losses",
  "type": "expense",
  "level": 4,
  "parentCode": "5301",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "530104",
  "name": "خسائر بيع أصول",
  "nameEn": "Loss on Disposal of Assets",
  "type": "expense",
  "level": 4,
  "parentCode": "5301",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "5302",
  "name": "مصروف الزكاة وضريبة الدخل",
  "nameEn": "Zakat and Income Tax Expense",
  "type": "expense",
  "level": 3,
  "parentCode": "53",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "530201",
  "name": "مصروف الزكاة",
  "nameEn": "Zakat Expense",
  "type": "expense",
  "level": 4,
  "parentCode": "5302",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "530202",
  "name": "مصروف ضريبة الدخل",
  "nameEn": "Income Tax Expense",
  "type": "expense",
  "level": 4,
  "parentCode": "5302",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "530203",
  "name": "مصروف ضريبة مؤجلة",
  "nameEn": "Deferred Tax Expense",
  "type": "expense",
  "level": 4,
  "parentCode": "5302",
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

