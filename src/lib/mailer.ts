import { Resend } from "resend";
import { env } from "../config/env";

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
  to: string;
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
    throw new Error(`فشل إرسال البريد الإلكتروني عبر Resend: ${result.error.message}`);
  }
}

/**
 * غلاف HTML موحّد لكل إيميلات النظام — نفس الألوان والخط المستخدمَين في PrintShell بالواجهة
 * الأمامية (#10202E داكن، #ECE6D6 فاتح، Tahoma/Arial)، بترويسة اسم "أثر المحاسبي" وتذييل ثابت،
 * حتى تبدو كل الرسائل (ترحيب، دعوة، فاتورة، استعادة كلمة مرور) بهوية بصرية واحدة متّسقة.
 */
function renderEmailShell(bodyHtml: string): string {
  return `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #10202E; background: #FBF9F3; padding: 24px; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="font-size: 18px; font-weight: 700; color: #10202E;">أثر المحاسبي</span>
      </div>
      ${bodyHtml}
      <p style="color:#8A7C5E; font-size: 11.5px; margin-top: 32px; border-top: 1px solid rgba(16,32,46,0.12); padding-top: 12px;">
        هذه رسالة آلية من نظام أثر المحاسبي — لا تحتاج للرد عليها.
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

export async function sendInviteEmail(to: string, activationPath: string) {
  const link = `${env.frontendBaseUrl}${activationPath}`;
  await sendEmail({
    to,
    subject: "دعوة للانضمام إلى أثر المحاسبي",
    logLabel: "دعوة مستخدم جديد",
    logBody: `رابط التفعيل: ${link}`,
    html: renderEmailShell(`
      <h2 style="color:#10202E;">دعوة للانضمام إلى أثر المحاسبي</h2>
      <p>تمت دعوتك للانضمام إلى نظام أثر المحاسبي. اضغط الرابط التالي لتفعيل حسابك وتعيين كلمة مرورك:</p>
      ${ctaButton(link, "تفعيل الحساب")}
      <p style="color:#6b7c8c; font-size: 12.5px;">لو لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br>${link}</p>
    `),
  });
}

export async function sendPasswordResetEmail(to: string, rawToken: string) {
  const link = `${env.frontendBaseUrl}/?token=${rawToken}#reset-password`;
  await sendEmail({
    to,
    subject: "إعادة تعيين كلمة المرور — أثر المحاسبي",
    logLabel: "طلب إعادة تعيين كلمة المرور",
    logBody: `رابط إعادة التعيين (صالح لمدة 30 دقيقة، استخدام واحد فقط): ${link}`,
    html: renderEmailShell(`
      <h2 style="color:#10202E;">إعادة تعيين كلمة المرور</h2>
      <p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك في أثر المحاسبي. اضغط الرابط التالي لتعيين كلمة مرور جديدة:</p>
      ${ctaButton(link, "إعادة تعيين كلمة المرور")}
      <p style="color:#6b7c8c; font-size: 12.5px;">هذا الرابط صالح لمدة 30 دقيقة ولمرة استخدام واحدة فقط. لو لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br>${link}</p>
      <p style="color:#6b7c8c; font-size: 12.5px;">لو لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة — لن يتغيّر شيء في حسابك.</p>
    `),
  });
}

/** يُرسَل مرة واحدة فوراً بعد نجاح تسجيل مستأجر/شركة جديدة — لا يوقف عملية التسجيل إن فشل (انظر موقع الاستدعاء في auth.service.ts). */
export async function sendWelcomeEmail(to: string, userName: string, companyName: string) {
  const link = `${env.frontendBaseUrl}/`;
  await sendEmail({
    to,
    subject: "أهلاً بك في أثر المحاسبي",
    logLabel: "إيميل ترحيبي",
    logBody: `رابط تسجيل الدخول: ${link}`,
    html: renderEmailShell(`
      <h2 style="color:#10202E;">أهلاً بك، ${userName}! 👋</h2>
      <p>تم إنشاء حساب "${companyName}" بنجاح في أثر المحاسبي. يمكنك الآن تسجيل الدخول والبدء في إدارة حساباتك المالية بكل سهولة.</p>
      ${ctaButton(link, "تسجيل الدخول")}
      <p style="color:#445565; font-size: 13px;">خطوات سريعة للبدء:</p>
      <ol style="color:#445565; font-size: 13px; padding-inline-start: 20px;">
        <li>أضِف بيانات شركتك الرسمية من شاشة الإعدادات.</li>
        <li>راجع شجرة الحسابات المُنشأة تلقائياً لنشاطك.</li>
        <li>ابدأ بتسجيل أول قيد أو فاتورة مبيعات.</li>
      </ol>
    `),
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
}

/** يُرسَل تلقائياً عند ترحيل فاتورة مبيعات (لو للعميل بريد مسجَّل)، أو يدوياً من زر "إرسال بالإيميل". */
export async function sendInvoiceEmail(params: InvoiceEmailParams) {
  await sendEmail({
    to: params.to,
    subject: `فاتورة رقم ${params.invoiceNumber} من ${params.companyName}`,
    logLabel: `إرسال فاتورة ${params.invoiceNumber}`,
    logBody: `العميل: ${params.customerName} — الإجمالي: ${params.grandTotal} ر.س`,
    attachments: [{ filename: params.pdfFileName, content: params.pdfBuffer }],
    html: renderEmailShell(`
      <h2 style="color:#10202E;">فاتورة جديدة من ${params.companyName}</h2>
      <p>عزيزي/عزيزتي ${params.customerName}،</p>
      <p>مرفق مع هذه الرسالة فاتورة رقم <strong>${params.invoiceNumber}</strong> بإجمالي <strong>${params.grandTotal} ر.س</strong>.</p>
      <p style="color:#6b7c8c; font-size: 12.5px;">يمكنكم فتح الملف المرفق (PDF) لعرض تفاصيل الفاتورة كاملة.</p>
    `),
  });
}
