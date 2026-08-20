import { Resend } from "resend";
import { env } from "../config/env";
import { Lang } from "./i18n/translate";

/**
 * غلاف بسيط لإرسال البريد الإلكتروني عبر Resend. بدون RESEND_API_KEY (بيئة تطوير محلية لم
 * تُضبط بعد)، يكتفي بطباعة محتوى الرسالة في الطرفية بدل الإرسال الفعلي — بديل آمن لا يتطلب
 * حساباً حقيقياً ولا يفشل الطلب الأصلي (طلب استعادة كلمة المرور مثلاً) لمجرد غياب الإعداد.
 */
const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

interface EmailAttachment {
  filename: string;
  content: Buffer;
}

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  logLabel: string;
  logBody: string;
  attachments?: EmailAttachment[];
}

async function sendEmail(params: SendEmailParams) {
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(
      `[mailer:console-fallback] ${params.logLabel} → ${params.to}\n${params.logBody}` +
        (params.attachments?.length ? `\n(${params.attachments.length} مرفق: ${params.attachments.map((a) => a.filename).join(", ")})` : ""),
    );
    return;
  }

  const result = await resend.emails.send({
    from: env.emailFromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments,
  });

  if (result.error) {
    throw new Error(`Failed to send email via Resend: ${result.error.message}`);
  }
}

/**
 * غلاف HTML موحّد لكل إيميلات النظام — نفس الألوان والخط المستخدمَين في PrintShell بالواجهة
 * الأمامية (#10202E داكن، #ECE6D6 فاتح، Tahoma/Arial)، بترويسة اسم "أثر المحاسبي" وتذييل ثابت،
 * حتى تبدو كل الرسائل (ترحيب، دعوة، فاتورة، استعادة كلمة مرور) بهوية بصرية واحدة متّسقة.
 */
function renderEmailShell(bodyHtml: string, lang: Lang, maxWidth = 480): string {
  const en = lang === "en";
  return `
    <div dir="${en ? "ltr" : "rtl"}" style="font-family: Tahoma, Arial, sans-serif; max-width: ${maxWidth}px; margin: 0 auto; color: #10202E; background: #FBF9F3; padding: 24px; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 18px; font-weight: 700; color: #10202E;">${en ? "Athar Accounting" : "أثر المحاسبي"}</span>
      </div>
      ${bodyHtml}
      <p style="color:#8A7C5E; font-size: 11.5px; margin-top: 32px; border-top: 1px solid rgba(16,32,46,0.12); padding-top: 12px;">
        ${en ? "This is an automated message from the Athar Accounting system — no need to reply." : "هذه رسالة آلية من نظام أثر المحاسبي — لا تحتاج للرد عليها."}
      </p>
    </div>
  `;
}

function ctaButton(link: string, label: string): string {
  return `
    <p style="margin: 24px 0;">
      <a href="${link}" style="background:#10202E; color:#ECE6D6; padding: 12px 24px; border-radius: 8px; text-decoration:none; display:inline-block;">${label}</a>
    </p>
  `;
}

export async function sendInviteEmail(to: string, activationPath: string, lang: Lang = "ar") {
  const link = `${env.frontendBaseUrl}${activationPath}`;
  const en = lang === "en";
  await sendEmail({
    to,
    subject: en ? "Invitation to join Athar Accounting" : "دعوة للانضمام إلى أثر المحاسبي",
    logLabel: en ? "New user invite" : "دعوة مستخدم جديد",
    logBody: en ? `Activation link: ${link}` : `رابط التفعيل: ${link}`,
    html: renderEmailShell(en ? `
      <h2 style="color:#10202E;">Invitation to join Athar Accounting</h2>
      <p>You've been invited to join the Athar Accounting system. Click the link below to activate your account and set your password:</p>
      ${ctaButton(link, "Activate account")}
      <p style="color:#6b7c8c; font-size: 12.5px;">If the button doesn't work, copy this link into your browser:<br>${link}</p>
    ` : `
      <h2 style="color:#10202E;">دعوة للانضمام إلى أثر المحاسبي</h2>
      <p>تمت دعوتك للانضمام إلى نظام أثر المحاسبي. اضغط الرابط التالي لتفعيل حسابك وتعيين كلمة مرورك:</p>
      ${ctaButton(link, "تفعيل الحساب")}
      <p style="color:#6b7c8c; font-size: 12.5px;">لو لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br>${link}</p>
    `, lang),
  });
}

export async function sendPasswordResetEmail(to: string, rawToken: string, lang: Lang = "ar") {
  const link = `${env.frontendBaseUrl}/?token=${rawToken}#reset-password`;
  const en = lang === "en";
  await sendEmail({
    to,
    subject: en ? "Password reset — Athar Accounting" : "إعادة تعيين كلمة المرور — أثر المحاسبي",
    logLabel: en ? "Password reset request" : "طلب إعادة تعيين كلمة المرور",
    logBody: en ? `Reset link (valid for 30 minutes, single use): ${link}` : `رابط إعادة التعيين (صالح لمدة 30 دقيقة، استخدام واحد فقط): ${link}`,
    html: renderEmailShell(en ? `
      <h2 style="color:#10202E;">Password reset</h2>
      <p>We received a request to reset your Athar Accounting account password. Click the link below to set a new password:</p>
      ${ctaButton(link, "Reset password")}
      <p style="color:#6b7c8c; font-size: 12.5px;">This link is valid for 30 minutes and can only be used once. If the button doesn't work, copy this link into your browser:<br>${link}</p>
      <p style="color:#6b7c8c; font-size: 12.5px;">If you didn't request a password reset, ignore this message — nothing will change on your account.</p>
    ` : `
      <h2 style="color:#10202E;">إعادة تعيين كلمة المرور</h2>
      <p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك في أثر المحاسبي. اضغط الرابط التالي لتعيين كلمة مرور جديدة:</p>
      ${ctaButton(link, "إعادة تعيين كلمة المرور")}
      <p style="color:#6b7c8c; font-size: 12.5px;">هذا الرابط صالح لمدة 30 دقيقة ولمرة استخدام واحدة فقط. لو لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br>${link}</p>
      <p style="color:#6b7c8c; font-size: 12.5px;">لو لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة — لن يتغيّر شيء في حسابك.</p>
    `, lang),
  });
}

/** يُرسَل مرة واحدة فوراً بعد نجاح تسجيل مستأجر/شركة جديدة — لا يوقف عملية التسجيل إن فشل (انظر موقع الاستدعاء في auth.service.ts). */
export async function sendWelcomeEmail(to: string, userName: string, companyName: string, lang: Lang = "ar") {
  const link = `${env.frontendBaseUrl}/`;
  const en = lang === "en";
  await sendEmail({
    to,
    subject: en ? "Welcome to Athar Accounting" : "أهلاً بك في أثر المحاسبي",
    logLabel: en ? "Welcome email" : "إيميل ترحيبي",
    logBody: en ? `Login link: ${link}` : `رابط تسجيل الدخول: ${link}`,
    html: renderEmailShell(en ? `
      <h2 style="color:#10202E;">Welcome, ${userName}! 👋</h2>
      <p>"${companyName}" has been created successfully in Athar Accounting. You can now log in and start managing your finances with ease.</p>
      ${ctaButton(link, "Log in")}
      <p style="color:#445565; font-size: 13px;">Quick steps to get started:</p>
      <ol style="color:#445565; font-size: 13px; padding-inline-start: 20px;">
        <li>Add your company's official details from the settings screen.</li>
        <li>Review the chart of accounts created automatically for your activity.</li>
        <li>Start by recording your first journal entry or sales invoice.</li>
      </ol>
    ` : `
      <h2 style="color:#10202E;">أهلاً بك، ${userName}! 👋</h2>
      <p>تم إنشاء حساب "${companyName}" بنجاح في أثر المحاسبي. يمكنك الآن تسجيل الدخول والبدء في إدارة حساباتك المالية بكل سهولة.</p>
      ${ctaButton(link, "تسجيل الدخول")}
      <p style="color:#445565; font-size: 13px;">خطوات سريعة للبدء:</p>
      <ol style="color:#445565; font-size: 13px; padding-inline-start: 20px;">
        <li>أضِف بيانات شركتك الرسمية من شاشة الإعدادات.</li>
        <li>راجع شجرة الحسابات المُنشأة تلقائياً لنشاطك.</li>
        <li>ابدأ بتسجيل أول قيد أو فاتورة مبيعات.</li>
      </ol>
    `, lang),
  });
}

interface InvoiceEmailParams {
  to: string;
  customerName: string;
  invoiceNumber: string;
  grandTotal: string;
  companyName: string;
  pdfBuffer: Buffer;
  pdfFileName: string;
  lang?: Lang;
}

/** يُرسَل تلقائياً عند ترحيل فاتورة مبيعات (لو للعميل بريد مسجَّل)، أو يدوياً من زر "إرسال بالإيميل". */
export async function sendInvoiceEmail(params: InvoiceEmailParams) {
  const en = params.lang === "en";
  await sendEmail({
    to: params.to,
    subject: en ? `Invoice #${params.invoiceNumber} from ${params.companyName}` : `فاتورة رقم ${params.invoiceNumber} من ${params.companyName}`,
    logLabel: en ? `Sending invoice ${params.invoiceNumber}` : `إرسال فاتورة ${params.invoiceNumber}`,
    logBody: en ? `Customer: ${params.customerName} — Total: SAR ${params.grandTotal}` : `العميل: ${params.customerName} — الإجمالي: ${params.grandTotal} ر.س`,
    attachments: [{ filename: params.pdfFileName, content: params.pdfBuffer }],
    html: renderEmailShell(en ? `
      <h2 style="color:#10202E;">New invoice from ${params.companyName}</h2>
      <p>Dear ${params.customerName},</p>
      <p>Attached is invoice <strong>#${params.invoiceNumber}</strong> for a total of <strong>SAR ${params.grandTotal}</strong>.</p>
      <p style="color:#6b7c8c; font-size: 12.5px;">You can open the attached PDF file to view the full invoice details.</p>
    ` : `
      <h2 style="color:#10202E;">فاتورة جديدة من ${params.companyName}</h2>
      <p>عزيزي/عزيزتي ${params.customerName}،</p>
      <p>مرفق مع هذه الرسالة فاتورة رقم <strong>${params.invoiceNumber}</strong> بإجمالي <strong>${params.grandTotal} ر.س</strong>.</p>
      <p style="color:#6b7c8c; font-size: 12.5px;">يمكنكم فتح الملف المرفق (PDF) لعرض تفاصيل الفاتورة كاملة.</p>
    `, params.lang ?? "ar"),
  });
}

/**
 * يُرسَل من مسار "إرسال الآن" اليدوي، ومن المُجدوِل التلقائي (reportScheduler.ts) عند استحقاق
 * جدولة شركة ما — نفس محتوى الرسالة (مبني مسبقاً عبر buildReportDigestEmail في reportDigest.ts)
 * يُرسَل لكل المستلمين معاً في طلب Resend واحد بدل تكرار الإرسال لكل بريد على حِدة، طالما لا
 * حاجة لتخصيص المحتوى بحسب المستلم هنا (بخلاف الفاتورة/الدعوة الموجّهة لشخص بعينه).
 */
export async function sendReportDigestEmail(to: string[], subject: string, bodyHtml: string, lang: Lang = "ar") {
  if (!to.length) return;
  await sendEmail({
    to,
    subject,
    logLabel: lang === "en" ? "Periodic financial report" : "التقرير المالي الدوري",
    logBody: subject,
    html: renderEmailShell(bodyHtml, lang, 640),
  });
}
