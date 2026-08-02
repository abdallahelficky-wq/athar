import { Resend } from "resend";
import { env } from "../config/env";

/**
 * غلاف بسيط لإرسال البريد الإلكتروني عبر Resend. بدون RESEND_API_KEY (بيئة تطوير محلية لم
 * تُضبط بعد)، يكتفي بطباعة محتوى الرسالة في الطرفية بدل الإرسال الفعلي — بديل آمن لا يتطلب
 * حساباً حقيقياً ولا يفشل الطلب الأصلي (طلب استعادة كلمة المرور مثلاً) لمجرد غياب الإعداد.
 */
const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

async function sendEmail(params: { to: string; subject: string; html: string; logLabel: string; logBody: string }) {
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(`[mailer:console-fallback] ${params.logLabel} → ${params.to}\n${params.logBody}`);
    return;
  }

  const result = await resend.emails.send({
    from: env.emailFromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (result.error) {
    throw new Error(`فشل إرسال البريد الإلكتروني عبر Resend: ${result.error.message}`);
  }
}

export async function sendInviteEmail(to: string, activationPath: string) {
  const link = `${env.frontendBaseUrl}${activationPath}`;
  await sendEmail({
    to,
    subject: "دعوة للانضمام إلى أثر المحاسبي",
    logLabel: "دعوة مستخدم جديد",
    logBody: `رابط التفعيل: ${link}`,
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #10202E;">
        <h2 style="color:#10202E;">دعوة للانضمام إلى أثر المحاسبي</h2>
        <p>تمت دعوتك للانضمام إلى نظام أثر المحاسبي. اضغط الرابط التالي لتفعيل حسابك وتعيين كلمة مرورك:</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background:#10202E; color:#ECE6D6; padding: 12px 24px; border-radius: 8px; text-decoration:none; display:inline-block;">تفعيل الحساب</a>
        </p>
        <p style="color:#6b7c8c; font-size: 12.5px;">لو لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br>${link}</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, rawToken: string) {
  const link = `${env.frontendBaseUrl}/?token=${rawToken}#reset-password`;
  await sendEmail({
    to,
    subject: "إعادة تعيين كلمة المرور — أثر المحاسبي",
    logLabel: "طلب إعادة تعيين كلمة المرور",
    logBody: `رابط إعادة التعيين (صالح لمدة 30 دقيقة، استخدام واحد فقط): ${link}`,
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #10202E;">
        <h2 style="color:#10202E;">إعادة تعيين كلمة المرور</h2>
        <p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك في أثر المحاسبي. اضغط الرابط التالي لتعيين كلمة مرور جديدة:</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background:#10202E; color:#ECE6D6; padding: 12px 24px; border-radius: 8px; text-decoration:none; display:inline-block;">إعادة تعيين كلمة المرور</a>
        </p>
        <p style="color:#6b7c8c; font-size: 12.5px;">هذا الرابط صالح لمدة 30 دقيقة ولمرة استخدام واحدة فقط. لو لم يعمل الزر، انسخ هذا الرابط والصقه في متصفحك:<br>${link}</p>
        <p style="color:#6b7c8c; font-size: 12.5px;">لو لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة — لن يتغيّر شيء في حسابك.</p>
      </div>
    `,
  });
}
