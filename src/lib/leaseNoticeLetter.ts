/**
 * خطاب إشعار المؤجر (تجديد عقد الإيجار، أو عدم تجديده وانتهاؤه بانتهاء مدته) — نص عربي رسمي يولّده النظام
 * من بيانات العقد والشركة. النص قابل للتعديل قبل الإرسال، ويُحفَظ كما أُرسل في LeaseNotice.
 */
export type LeaseNoticeKind = "renewal" | "termination";

export type LeaseNoticeLetterInput = {
  kind: LeaseNoticeKind;
  // lessee (الافتراضي): الشركة مستأجرة والخطاب للمؤجر. lessor: الشركة مؤجرة والخطاب للمستأجر.
  direction?: "lessee" | "lessor";
  letterDate: string; // YYYY-MM-DD
  company: { name: string; crNumber?: string | null };
  contract: {
    title: string;
    counterparty?: string | null;
    contractNumber?: string | null;
    signedOn?: string | null;
    startDate: string;
    endDate: string;
    noticeDays?: number | null;
    noticeDeadline?: string | null;
    autoRenew?: boolean | null;
    address?: string | null;
    city?: string | null;
  };
};

const fmt = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

export function buildLeaseNoticeLetter(input: LeaseNoticeLetterInput): { subject: string; body: string } {
  const { kind, company, contract: c } = input;
  const number = c.contractNumber?.trim() || "";
  const asLessor = input.direction === "lessor";
  const other = c.counterparty?.trim() || (asLessor ? "المستأجر" : "المؤجر");
  const parties = asLessor ? `${company.name} (المؤجر) و${other} (المستأجر)` : `${other} (المؤجر) و${company.name} (المستأجر)`;
  const location = [c.title, c.address?.trim(), c.city?.trim()].filter(Boolean).join(" — ");
  const ref = number ? `عقد الإيجار رقم ${number}` : `عقد الإيجار الخاص بـ${c.title}`;
  const subject = kind === "renewal" ? `إشعار برغبة تجديد ${ref}` : `إشعار بعدم تجديد ${ref} وانتهائه بانتهاء مدته`;

  const intro =
    `بالإشارة إلى ${ref} الموثق عبر الشبكة الإلكترونية لخدمات الإيجار (إيجار)` +
    (c.signedOn ? ` والمبرم بتاريخ ${fmt(c.signedOn)}` : "") +
    ` بين ${parties}، بشأن ${location}، ومدته من ${fmt(c.startDate)} إلى ${fmt(c.endDate)}،`;

  const notice = c.noticeDays ? ` وإعمالاً لشرط الإشعار المنصوص عليه في العقد (${c.noticeDays} يوماً قبل نهاية المدة)،` : "";
  const core =
    kind === "renewal"
      ? `${notice} نفيدكم برغبتنا في تجديد العقد لمدة أخرى، ونأمل التنسيق معنا للاتفاق على شروط التجديد وتوثيقه عبر شبكة إيجار قبل تاريخ ${fmt(c.endDate)}.`
      : asLessor
        ? `${notice} نفيدكم بعدم رغبتنا في تجديد العقد، وأن العلاقة الإيجارية تنتهي بانتهاء مدته في ${fmt(c.endDate)}، وعليه نأمل إخلاء العين المؤجرة وتسليمها في نهاية المدة بالحالة المتفق عليها، وتوثيق التسليم عبر نموذج تسليم الوحدة في شبكة إيجار، مع سداد ما قد يستحق من مبالغ حتى تاريخ الإخلاء.`
        : `${notice} نفيدكم بعدم رغبتنا في تجديد العقد، وأن العلاقة الإيجارية تنتهي بانتهاء مدته في ${fmt(c.endDate)}، على أن يتم تسليم العين المؤجرة وتوثيق حالتها عبر نموذج تسليم الوحدة في شبكة إيجار.`;

  const body = [
    `التاريخ: ${fmt(input.letterDate)}`,
    "",
    `السادة/ ${other}                     المحترمين`,
    "",
    `الموضوع: ${subject}`,
    "",
    "السلام عليكم ورحمة الله وبركاته،",
    "",
    `${intro}${core}`,
    "",
    "شاكرين لكم حسن تعاونكم، وتفضلوا بقبول فائق الاحترام والتقدير،،،",
    "",
    company.name,
    company.crNumber ? `سجل تجاري رقم: ${company.crNumber}` : null,
    "",
    "المفوَّض بالتوقيع: ______________________",
    "التوقيع والختم: ______________________",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject, body };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** محتوى البريد المرسَل للمسؤول في الشركة: تعليمات قصيرة ثم نص الخطاب كما سيُبلَّغ للمؤجر. */
export function buildLeaseNoticeEmailHtml(opts: { companyName: string; contractTitle: string; kind: LeaseNoticeKind; noticeDeadline?: string | null; body: string; direction?: "lessee" | "lessor" }) {
  const what = opts.kind === "renewal" ? "إشعار برغبة التجديد" : "إشعار بعدم التجديد";
  const deadline = opts.noticeDeadline ? ` قبل ${fmt(opts.noticeDeadline)} (آخر موعد للإشعار حسب العقد)` : "";
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.9;color:#1c2a38">
<p>مطلوب تبليغ ${opts.direction === "lessor" ? "المستأجر" : "المؤجر"} بـ<b>${what}</b> لعقد <b>${esc(opts.contractTitle)}</b>${deadline}، بالنص التالي المولَّد من أثر:</p>
<div style="white-space:pre-wrap;border:1px solid #CFE8DA;background:#F7FBF9;border-radius:10px;padding:16px 18px;margin:12px 0">${esc(opts.body)}</div>
<p style="color:#5B6B7B;font-size:12.5px">${esc(opts.companyName)} — يمكن طباعة الخطاب من شاشة عقود الإيجار في أثر.</p></div>`;
}
