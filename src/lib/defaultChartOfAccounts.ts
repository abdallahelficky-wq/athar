import { randomUUID } from "node:crypto";
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
  "code": "111001",
  "name": "الصندوق النقدي - الإدارة العامة",
  "nameEn": "Cash on Hand - Head Office",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "111002",
  "name": "صندوق نثرية الفروع/المواقع",
  "nameEn": "Petty Cash - Branches/Sites",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "111003",
  "name": "بنك - حساب جاري (1)",
  "nameEn": "Bank - Current Account (1)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "111004",
  "name": "بنك - حساب جاري (2)",
  "nameEn": "Bank - Current Account (2)",
  "type": "asset",
  "level": 4,
  "parentCode": "111",
  "isPosting": true,
  "isBankOrCash": true
},
{
  "code": "111005",
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
  "code": "112001",
  "name": "عملاء - مبيعات جملة/عقود",
  "nameEn": "Customers - Wholesale/Contract Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "112002",
  "name": "عملاء - مبيعات نقدية/تجزئة",
  "nameEn": "Customers - Cash/Retail Sales",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "112003",
  "name": "أوراق قبض",
  "nameEn": "Notes Receivable",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "112004",
  "name": "عملاء - أطراف ذات علاقة",
  "nameEn": "Customers - Related Parties",
  "type": "asset",
  "level": 4,
  "parentCode": "112",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "112005",
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
  "code": "113001",
  "name": "دفعات مقدمة لموردين",
  "nameEn": "Advances to Suppliers",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113002",
  "name": "سلف وقروض الموظفين",
  "nameEn": "Employee Advances and Loans",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113003",
  "name": "ضريبة القيمة المضافة - مدينة (مشتريات)",
  "nameEn": "VAT Receivable (Purchases)",
  "type": "asset",
  "level": 4,
  "parentCode": "113",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "113004",
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
  "code": "114001",
  "name": "مخزون بضاعة للبيع",
  "nameEn": "Merchandise Inventory for Sale",
  "type": "asset",
  "level": 4,
  "parentCode": "114",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "114002",
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
  "code": "115001",
  "name": "إيجارات مدفوعة مقدماً",
  "nameEn": "Prepaid Rent",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115002",
  "name": "تأمين مدفوع مقدماً",
  "nameEn": "Prepaid Insurance",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "115003",
  "name": "اشتراكات ورخص مدفوعة مقدماً",
  "nameEn": "Prepaid Subscriptions and Licenses",
  "type": "asset",
  "level": 4,
  "parentCode": "115",
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
  "code": "121001",
  "name": "أراضٍ",
  "nameEn": "Land",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121002",
  "name": "مباني ومنشآت",
  "nameEn": "Buildings and Structures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121003",
  "name": "آلات ومعدات",
  "nameEn": "Machinery and Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121004",
  "name": "سيارات ووسائل نقل",
  "nameEn": "Vehicles and Transport Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121005",
  "name": "أثاث وتجهيزات مكتبية",
  "nameEn": "Office Furniture and Fixtures",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121006",
  "name": "أجهزة حاسب آلي",
  "nameEn": "Computer Equipment",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121007",
  "name": "تحسينات على مأجور",
  "nameEn": "Leasehold Improvements",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121008",
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
  "code": "122001",
  "name": "برامج وأنظمة",
  "nameEn": "Software and Systems",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122002",
  "name": "شهرة المحل",
  "nameEn": "Goodwill",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122003",
  "name": "تراخيص وامتيازات تجارية",
  "nameEn": "Commercial Licenses and Franchises",
  "type": "asset",
  "level": 4,
  "parentCode": "122",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "122004",
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
  "code": "123001",
  "name": "استثمارات طويلة الأجل",
  "nameEn": "Long-Term Investments",
  "type": "asset",
  "level": 4,
  "parentCode": "123",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "123002",
  "name": "تأمينات مستردة طويلة الأجل",
  "nameEn": "Long-Term Refundable Deposits",
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
  "code": "211001",
  "name": "موردون - محليون",
  "nameEn": "Suppliers - Local",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "211002",
  "name": "موردون - مستوردون",
  "nameEn": "Suppliers - Importers",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "211003",
  "name": "أوراق دفع",
  "nameEn": "Notes Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "211",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "211004",
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
  "code": "212001",
  "name": "رواتب مستحقة",
  "nameEn": "Accrued Salaries",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212002",
  "name": "إيجارات مستحقة",
  "nameEn": "Accrued Rent",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212003",
  "name": "مصروفات مستحقة أخرى",
  "nameEn": "Other Accrued Expenses",
  "type": "liability",
  "level": 4,
  "parentCode": "212",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "212004",
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
  "code": "213001",
  "name": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "nameEn": "VAT Payable (Sales)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213002",
  "name": "الزكاة المستحقة",
  "nameEn": "Zakat Payable",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213003",
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
  "code": "214001",
  "name": "قرض بنكي قصير الأجل",
  "nameEn": "Short-Term Bank Loan",
  "type": "liability",
  "level": 4,
  "parentCode": "214",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "214002",
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
  "name": "دفعات مقدمة ومطلوبات أخرى",
  "nameEn": "Advances and Other Liabilities",
  "type": "liability",
  "level": 3,
  "parentCode": "21",
  "isPosting": false,
  "isBankOrCash": false
},
{
  "code": "215001",
  "name": "دفعات مقدمة من عملاء",
  "nameEn": "Advances from Customers",
  "type": "liability",
  "level": 4,
  "parentCode": "215",
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
  "code": "221001",
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
  "code": "222001",
  "name": "مخصص نهاية الخدمة - طويل الأجل",
  "nameEn": "End of Service Provision - Long-Term",
  "type": "liability",
  "level": 4,
  "parentCode": "222",
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
  "code": "311001",
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
  "code": "321001",
  "name": "الاحتياطي النظامي",
  "nameEn": "Statutory Reserve",
  "type": "equity",
  "level": 4,
  "parentCode": "321",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "321002",
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
  "code": "331001",
  "name": "أرباح مرحلة من سنوات سابقة",
  "nameEn": "Retained Earnings from Prior Years",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "331002",
  "name": "صافي ربح / خسارة العام الحالي",
  "nameEn": "Net Income / Loss for the Current Year",
  "type": "equity",
  "level": 4,
  "parentCode": "331",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "331003",
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
  "code": "341001",
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
  "code": "411001",
  "name": "إيرادات المبيعات",
  "nameEn": "Sales Revenue",
  "type": "revenue",
  "level": 4,
  "parentCode": "411",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "411002",
  "name": "إيرادات الخدمات",
  "nameEn": "Service Revenue",
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
  "code": "421001",
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
  "code": "431001",
  "name": "إيراد بيع خردة / أصول",
  "nameEn": "Gain on Sale of Scrap / Assets",
  "type": "revenue",
  "level": 4,
  "parentCode": "431",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "431002",
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
  "code": "511001",
  "name": "تكلفة البضاعة المباعة",
  "nameEn": "Cost of Goods Sold",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "511002",
  "name": "تكلفة الخدمات المقدمة",
  "nameEn": "Cost of Services Rendered",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "511003",
  "name": "مصاريف شحن ومناولة مشتريات",
  "nameEn": "Freight and Handling on Purchases",
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
  "code": "611001",
  "name": "رواتب الموظفين - الإدارة العامة",
  "nameEn": "Employee Salaries - Head Office",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "611002",
  "name": "رواتب موظفي الميدان/الموقع",
  "nameEn": "Field/Site Staff Salaries",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "611003",
  "name": "بدلات ومكافآت",
  "nameEn": "Allowances and Bonuses",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "611004",
  "name": "التأمينات الاجتماعية (GOSI)",
  "nameEn": "Social Insurance (GOSI)",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "611005",
  "name": "التأمين الطبي",
  "nameEn": "Medical Insurance",
  "type": "expense",
  "level": 4,
  "parentCode": "611",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "611006",
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
  "code": "621001",
  "name": "إيجار المقر الرئيسي",
  "nameEn": "Head Office Rent",
  "type": "expense",
  "level": 4,
  "parentCode": "621",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "621002",
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
  "code": "622001",
  "name": "قرطاسية ومطبوعات",
  "nameEn": "Stationery and Printing",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622002",
  "name": "اتصالات وإنترنت",
  "nameEn": "Telecommunications and Internet",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622003",
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
  "code": "623001",
  "name": "أتعاب محاسبة ومراجعة",
  "nameEn": "Accounting and Audit Fees",
  "type": "expense",
  "level": 4,
  "parentCode": "623",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "623002",
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
  "code": "624001",
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
  "code": "631001",
  "name": "حملات تسويقية وإعلانية",
  "nameEn": "Marketing and Advertising Campaigns",
  "type": "expense",
  "level": 4,
  "parentCode": "631",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "631002",
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
  "code": "641001",
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
  "code": "642001",
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
  "code": "651001",
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
  "code": "652001",
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
  "code": "661001",
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
  "code": "662001",
  "name": "مخصص ديون مشكوك فيها (مصروف الفترة)",
  "nameEn": "Doubtful Debts Expense (Period)",
  "type": "expense",
  "level": 4,
  "parentCode": "662",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "662002",
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
  "code": "711001",
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
  "code": "721001",
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
  "code": "731001",
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
  "code": "741001",
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
  "code": "811001",
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
  "code": "821001",
  "name": "ضمانات بنكية صادرة",
  "nameEn": "Bank Guarantees Issued",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "821002",
  "name": "التزامات محتملة (Contingent Liabilities)",
  "nameEn": "Contingent Liabilities",
  "type": "liability",
  "level": 4,
  "parentCode": "821",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "213000",
  "name": "تأمينات اجتماعية مستحقة",
  "nameEn": "Accrued Social Insurance (GOSI Payable)",
  "type": "liability",
  "level": 4,
  "parentCode": "213",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "622000",
  "name": "سفر وانتقالات",
  "nameEn": "Travel and Transportation",
  "type": "expense",
  "level": 4,
  "parentCode": "622",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "121000",
  "name": "أصول ثابتة أخرى",
  "nameEn": "Other Fixed Assets",
  "type": "asset",
  "level": 4,
  "parentCode": "121",
  "isPosting": true,
  "isBankOrCash": false
},
{
  "code": "511000",
  "name": "فروقات وهبوط مخزون",
  "nameEn": "Inventory Adjustments and Shrinkage",
  "type": "expense",
  "level": 4,
  "parentCode": "511",
  "isPosting": true,
  "isBankOrCash": false
}
];

/**
 * ينشئ شجرة حسابات كاملة من أي قالب (الافتراضي أو أحد قوالب الأنشطة في chartTemplates.ts)،
 * ويُرجع خريطة كود->معرّف الحساب المُنشأ فعلياً في قاعدة البيانات، حتى يمكن للمستدعي (مثل
 * createCompany) ربط أصناف/بيانات ابتدائية أخرى بحسابات بعينها من نفس الشجرة التي أُنشئت للتو.
 *
 * نُنشئ كل معرّفات الحسابات في الذاكرة أولاً بدل الاعتماد على cuid() التلقائي من قاعدة البيانات،
 * حتى يمكن ربط كل حساب فرعي بمعرّف أبيه معروفاً سلفاً، ثم نُدرِج الجميع بطلب INSERT دفعي واحد
 * (createMany) بدل رحلة شبكة منفصلة لكل حساب — التتابع القديم كان يتجاوز أحياناً مهلة معاملة
 * Prisma الافتراضية (5 ثوانٍ) على شبكة الإنتاج (P2028)، رغم نجاحه محلياً حيث زمن الاتصال بقاعدة
 * البيانات شبه معدوم.
 */
export async function createChartFromTemplate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string | null,
  template: DefaultChartAccount[],
): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();
  const rows = template.map((account) => {
    const parentId = account.parentCode ? idByCode.get(account.parentCode) : null;
    if (account.parentCode && !parentId) {
      throw new Error(`الحساب الأب ${account.parentCode} غير موجود عند إنشاء شجرة الحسابات`);
    }
    const id = randomUUID();
    idByCode.set(account.code, id);
    return {
      id,
      tenantId,
      companyId,
      parentId: parentId || null,
      code: account.code,
      level: account.level,
      isPosting: account.isPosting,
      name: account.name,
      nameEn: account.nameEn,
      type: account.type,
      isBankOrCash: account.isBankOrCash || false,
    };
  });

  await tx.account.createMany({ data: rows });
  return idByCode;
}

export async function createDefaultChart(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string | null,
): Promise<Map<string, string>> {
  return createChartFromTemplate(tx, tenantId, companyId, DEFAULT_CHART_OF_ACCOUNTS);
}

