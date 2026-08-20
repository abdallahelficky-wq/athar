import { AR_TO_EN } from "./errorMessages";

/**
 * أنماط ترجمة الرسائل التفاعلية (تحمل قيماً ديناميكية داخل الجملة العربية، مثل اسم صنف أو رقم
 * فاتورة) — لا تصلح لمطابقة نصية حرفية كقاموس AR_TO_EN، فتُطابَق بتعبير نمطي (regex) يلتقط الجزء
 * الثابت من الجملة، ثم يُعاد بناء الجملة الإنجليزية حول نفس القيم الملتقَطة. تُطبَّق في translate.ts
 * كمحاولة ثانية بعد فشل المطابقة الحرفية في AR_TO_EN، فلا تُغيَّر منطق الأعمال في الملفات الأصلية
 * (controllers/services) إطلاقاً — الرسالة العربية الأصلية تبقى كما هي، وتُترجَم فقط عند بناء
 * الاستجابة النهائية في errorHandler.ts.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translateLabels(text: string, labels: [string, string][]): string {
  let out = text;
  for (const [ar, en] of labels) out = out.split(ar).join(en);
  return out;
}

function translateReasonsList(text: string, labels: [string, string][]): string {
  return translateLabels(text, labels).split("، ").join(", ").split(" و").join(" and ");
}

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** يترجم شهراً/سنة بصيغة monthLabel() المشتركة في payrollRuns.service.ts/depreciation.service.ts
 * (مثال: "أغسطس ٢٠٢٦") إلى الإنجليزية — يحوّل الأرقام العربية-الهندية أولاً ثم اسم الشهر. */
function translateArabicMonthYear(text: string): string {
  let out = text.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  AR_MONTHS.forEach((m, i) => { out = out.split(m).join(EN_MONTHS[i]); });
  return out;
}

const CUSTOMER_REASON_LABELS: [string, string][] = [
  ["فاتورة مبيعات", "sales invoice(s)"],
  ["عرض سعر", "quotation(s)"],
  ["مردود مبيعات", "sales return(s)"],
  ["سند قبض", "receipt voucher(s)"],
  ["حركة في القيود", "journal entry line(s)"],
];
const SUPPLIER_REASON_LABELS: [string, string][] = [
  ["فاتورة مشتريات", "purchase invoice(s)"],
  ["مردود مشتريات", "purchase return(s)"],
  ["حركة في القيود", "journal entry line(s)"],
];
const ACCOUNT_DELETE_REASON_LABELS: [string, string][] = [
  ["حسابات فرعية", "sub-accounts"],
  ["حركات أو قيود مرتبطة", "linked transactions or entries"],
];
const ACCOUNT_TYPE_LABELS_EN: Record<string, string> = {
  "أصول": "Assets",
  "التزامات": "Liabilities",
  "حقوق ملكية": "Equity",
  "إيرادات": "Revenue",
  "مصروفات": "Expenses",
};
const ASSET_ROLE_LABELS_EN: [string, string][] = [
  ["حساب اقتناء الأصل", "Asset acquisition account"],
  ["حساب مجمع الإهلاك", "Accumulated depreciation account"],
  ["حساب مصروف الإهلاك", "Depreciation expense account"],
];

interface MessagePattern {
  match: RegExp;
  translate: (groups: string[]) => string;
}

export const DYNAMIC_MESSAGE_PATTERNS: MessagePattern[] = [
  { match: /^متغير البيئة المطلوب غير موجود: (.+)$/, translate: (g) => `Required environment variable not found: ${g[0]}` },
  { match: /^فشل استدعاء نموذج الذكاء الاصطناعي \((.+?)\): ([\s\S]*)$/, translate: (g) => `AI model call failed (${g[0]}): ${g[1]}` },
  { match: /^الحساب الأب (.+) غير موجود عند إنشاء شجرة الحسابات$/, translate: (g) => `Parent account ${g[0]} does not exist when creating the chart of accounts` },
  { match: /^فشل إرسال البريد الإلكتروني عبر Resend: ([\s\S]*)$/, translate: (g) => `Failed to send email via Resend: ${g[0]}` },
  { match: /^حساب التجميع بالكود "(.+)" غير موجود في شجرة هذه الشركة$/, translate: (g) => `The group account with code "${g[0]}" does not exist in this company's chart of accounts` },
  { match: /^حساب التجميع المطلوب \((.+)\) غير موجود في شجرة هذه الشركة$/, translate: (g) => `The required group account (${g[0]}) does not exist in this company's chart of accounts` },
  { match: /^تعذّر إيجاد الحساب (.+?) \((.+?)\) عند زرع الأصناف الافتراضية لهذا النشاط$/, translate: (g) => `Couldn't find account ${g[0]} (${g[1]}) when seeding default items for this activity` },
  { match: /^مكوّن الصنف المجمّع (.+?) غير معرَّف قبل (.+?) في قائمة الأصناف الافتراضية$/, translate: (g) => `Bundled item component ${g[0]} is not defined before ${g[1]} in the default items list` },
  { match: /^الحساب المطلوب لترحيل هذه المعاملة غير موجود في شجرة الشركة: "(.+)"$/, translate: (g) => `The account required to post this transaction does not exist in the company's chart of accounts: "${g[0]}"` },
  { match: /^قيمة الوسم (.+?) تتجاوز 255 بايت — الحد الأقصى لبنية TLV$/, translate: (g) => `Tag ${g[0]}'s value exceeds 255 bytes — the maximum for TLV structure` },
  { match: /^كود المستوى (.+?) يجب أن يتكون من (.+?) أرقام$/, translate: (g) => `The level ${g[0]} code must be ${g[1]} digits` },
  { match: /^كود الحساب (.+?) مستخدم بالفعل في هذه الشجرة$/, translate: (g) => `Account code ${g[0]} is already used in this chart of accounts` },
  {
    match: /^لا يمكن نقل حساب من نوع "(.+?)" إلى مجموعة من نوع "(.+?)" — النقل مسموح فقط بين مجموعات من نفس النوع\.$/,
    translate: (g) => `Can't move an account of type "${ACCOUNT_TYPE_LABELS_EN[g[0]] ?? g[0]}" into a group of type "${ACCOUNT_TYPE_LABELS_EN[g[1]] ?? g[1]}" — moving is only allowed between groups of the same type.`,
  },
  { match: /^حساب المستوى (.+?) \((.+?)\) يجب أن يحمل كوداً من (.+?) أرقام$/, translate: (g) => `Level ${g[0]} account (${g[1]}) must have a ${g[2]}-digit code` },
  { match: /^الحساب (.+?): الترحيل متاح حصراً في المستوى الرابع$/, translate: (g) => `Account ${g[0]}: posting is only available at level 4` },
  { match: /^الحساب (.+?) من المستوى الأول ولا يقبل حساباً أباً$/, translate: (g) => `Account ${g[0]} is a level-1 account and cannot have a parent account` },
  { match: /^الحساب الأب مفقود للكود (.+)$/, translate: (g) => `The parent account is missing for code ${g[0]}` },
  { match: /^كود الحساب (.+?) يجب أن يبدأ بكود الحساب الأب (.+)$/, translate: (g) => `Account code ${g[0]} must start with the parent account's code ${g[1]}` },
  { match: /^الحساب الأب (.+?) غير موجود بالمستوى السابق للحساب (.+)$/, translate: (g) => `Parent account ${g[0]} does not exist at the previous level for account ${g[1]}` },
  { match: /^الحساب الأب (.+?) هو حساب ترحيل ولا يقبل حسابات فرعية$/, translate: (g) => `Parent account ${g[0]} is a posting account and cannot have sub-accounts` },
  {
    match: /^لا يمكن حذف الحساب لوجود (.+)\. استخدم الأرشفة بدلاً من الحذف\.$/,
    translate: (g) => `Can't delete this account because it has ${translateReasonsList(g[0], ACCOUNT_DELETE_REASON_LABELS)}. Use archiving instead of deleting.`,
  },
  ...ASSET_ROLE_LABELS_EN.flatMap(([ar, en]): MessagePattern[] => [
    { match: new RegExp(`^${escapeRegExp(ar)}: الحساب المختار غير موجود ضمن شجرة هذه الشركة$`), translate: () => `${en}: the selected account does not exist in this company's chart of accounts` },
    { match: new RegExp(`^${escapeRegExp(ar)}: الحساب المختار ليس حساب ترحيل نشطاً$`), translate: () => `${en}: the selected account isn't an active posting account` },
    { match: new RegExp(`^${escapeRegExp(ar)}: نوع الحساب المختار غير مطابق \\(متوقَّع (.+?)\\)$`), translate: (g) => `${en}: the selected account's type doesn't match (expected ${g[0]})` },
  ]),
  { match: /^رفضت زاتكا طلب شهادة الاختبار: ([\s\S]+)$/, translate: (g) => `ZATCA rejected the compliance certificate request: ${g[0].split("لا يوجد رد").join("No response")}` },
  { match: /^رفضت زاتكا طلب شهادة الإنتاج: ([\s\S]+)$/, translate: (g) => `ZATCA rejected the production certificate request: ${g[0].split("لا يوجد رد").join("No response")}` },
  {
    match: /^لا يمكن حذف هذا العميل لارتباطه بـ (.+)\. عدّل بيانات العميل بدلاً من حذفه إن لزم الأمر\.$/,
    translate: (g) => `Can't delete this customer because it's linked to ${translateReasonsList(g[0], CUSTOMER_REASON_LABELS)}. Edit the customer's data instead of deleting it if needed.`,
  },
  {
    match: /^لا يمكن حذف هذا المورد لارتباطه بـ (.+)\. عدّل بيانات المورد بدلاً من حذفه إن لزم الأمر\.$/,
    translate: (g) => `Can't delete this supplier because it's linked to ${translateReasonsList(g[0], SUPPLIER_REASON_LABELS)}. Edit the supplier's data instead of deleting it if needed.`,
  },
  { match: /^تم ترحيل إهلاك شهر (.+?) مسبقاً لهذه الشركة$/, translate: (g) => `Depreciation for ${translateArabicMonthYear(g[0])} has already been posted for this company` },
  { match: /^يوجد كشف رواتب لشهر (.+?) لهذه الشركة بالفعل$/, translate: (g) => `A payroll run for ${translateArabicMonthYear(g[0])} already exists for this company` },
  {
    match: /^الحقول التالية مطلوبة لهذا النوع من الأصناف: (.+)$/,
    translate: (g) => `The following fields are required for this item type: ${g[0].split("، ").map((s) => AR_TO_EN[s] ?? s).join(", ")}`,
  },
  { match: /^لم يتم ربط الحسابات التالية بحساب فعلي بعد: (.+)$/, translate: (g) => `The following accounts haven't been linked to a real account yet: ${g[0]}` },
  { match: /^فئة الأصل "(.+?)" غير مرتبطة بحساب هذا السطر$/, translate: (g) => `The asset category "${g[0]}" isn't linked to this line's account` },
  { match: /^حساب التجميع "الذمم المدينة الأخرى" غير موجود في شجرة (.+)$/, translate: (g) => `The group account "Other Receivables" does not exist in ${g[0]}'s chart of accounts` },
  { match: /^الصيغة تحتوي على مرجع دائري بين البنود: (.+)$/, translate: (g) => `The formula contains a circular reference between components: ${g[0]}` },
  { match: /^الصنف "(.+?)" من نوع خدمي، لا يمكن شراؤه$/, translate: (g) => `Item "${g[0]}" is a service-type item, it can't be purchased` },
  { match: /^الصنف "(.+?)" منتج مجمّع — رصيده يزيد فقط عبر أمر تصنيع، لا الشراء المباشر$/, translate: (g) => `Item "${g[0]}" is a bundled product — its balance only increases via a manufacturing order, not a direct purchase` },
  { match: /^أدخل العمر الإنتاجي وقيمة الخردة للصنف "(.+?)"$/, translate: (g) => `Enter the useful life and salvage value for item "${g[0]}"` },
  { match: /^حدّد فئة الأصل للصنف "(.+?)" من شاشة الأصناف أولاً$/, translate: (g) => `Set the asset category for item "${g[0]}" from the items screen first` },
  { match: /^اختر مستودعاً صالحاً ضمن هذه الشركة للصنف "(.+?)"$/, translate: (g) => `Choose a valid warehouse in this company for item "${g[0]}"` },
  { match: /^لم يُحدَّد الحساب المحاسبي المرتبط بالصنف "(.+?)" بعد؛ أكمل بياناته من شاشة الأصناف أولاً$/, translate: (g) => `The account linked to item "${g[0]}" hasn't been set yet; complete its data from the items screen first` },
  { match: /^المبلغ المخصص للفاتورة (.+?) أكبر من المتبقي عليها \((.+?)\)$/, translate: (g) => `The amount allocated to invoice ${g[0]} exceeds its remaining balance (${g[1]})` },
  { match: /^المبلغ أكبر من المتبقي على هذه الفاتورة \((.+?)\)$/, translate: (g) => `The amount exceeds this invoice's remaining balance (${g[0]})` },
  { match: /^رفضت هيئة الزكاة والضريبة والجمارك إشعار المدين: ([\s\S]+)$/, translate: (g) => `ZATCA rejected the debit note: ${g[0]}` },
  { match: /^الصنف "(.+?)" من نوع مصروف، لا يمكن بيعه$/, translate: (g) => `Item "${g[0]}" is an expense-type item, it can't be sold` },
  { match: /^الصنف "(.+?)" أصل ثابت، لا يُباع عبر فاتورة مبيعات$/, translate: (g) => `Item "${g[0]}" is a fixed asset, it can't be sold via a sales invoice` },
  { match: /^الصنف "(.+?)" مادة أولية غير مسموح ببيعها منفردة$/, translate: (g) => `Item "${g[0]}" is a raw material that isn't allowed to be sold on its own` },
  { match: /^لم يُحدَّد حساب الإيراد المرتبط بالصنف "(.+?)" بعد؛ أكمل بياناته من شاشة الأصناف أولاً$/, translate: (g) => `The revenue account linked to item "${g[0]}" hasn't been set yet; complete its data from the items screen first` },
  { match: /^الكمية الإجمالية المطلوبة من "(.+?)" \((.+?)\) أكبر من الرصيد المتاح \((.+?)\)$/, translate: (g) => `The total quantity requested of "${g[0]}" (${g[1]}) exceeds the available balance (${g[2]})` },
  { match: /^لم تُحدَّد حسابات المخزون\/التكلفة للصنف "(.+?)" بعد؛ أكمل بياناته من شاشة الأصناف أولاً$/, translate: (g) => `The inventory/cost accounts for item "${g[0]}" haven't been set yet; complete its data from the items screen first` },
  { match: /^رفضت هيئة الزكاة والضريبة والجمارك الفاتورة: ([\s\S]+)$/, translate: (g) => `ZATCA rejected the invoice: ${g[0]}` },
  { match: /^رفضت هيئة الزكاة والضريبة والجمارك إشعار الدائن: ([\s\S]+)$/, translate: (g) => `ZATCA rejected the credit note: ${g[0]}` },
  { match: /^الكمية المطلوبة \((.+?)\) أكبر من الرصيد المتاح \((.+?)\)$/, translate: (g) => `The requested quantity (${g[0]}) exceeds the available balance (${g[1]})` },
  { match: /^الكمية المطلوبة \((.+?)\) أكبر من الرصيد المتاح بالمصدر \((.+?)\)$/, translate: (g) => `The requested quantity (${g[0]}) exceeds the available balance at the source (${g[1]})` },
  { match: /^لا يوجد صنف مطابق بنفس الكود \((.+?)\) في شركة الوجهة؛ أنشئه أولاً هناك قبل التحويل$/, translate: (g) => `No matching item with the same code (${g[0]}) exists in the destination company; create it there first before transferring` },
];
