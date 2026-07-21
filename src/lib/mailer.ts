/**
 * غلاف بسيط لإرسال البريد الإلكتروني. في المرحلة صفر يكتفي بتسجيل الرسالة في الطرفية،
 * وفي مزوّد إنتاج حقيقي يُستبدل جسم الدالتين بربط فعلي مع Resend/Amazon SES/SendGrid
 * (كما هو مقترح في القسم 2 من ATHAR_BACKEND_SPEC.md) دون تغيير أي كود مستدعٍ لها.
 */
export async function sendInviteEmail(to: string, activationLink: string) {
  // eslint-disable-next-line no-console
  console.log(`[mailer:stub] دعوة مستخدم جديد → ${to}\nرابط التفعيل: ${activationLink}`);
}
