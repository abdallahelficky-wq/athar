/**
 * حساب المخزون الذي يُرحَّل عليه صنف داخل مستودع معيّن: حساب المستودع إن حُدِّد له حساب، وإلا حساب مخزون الصنف.
 *
 * المستودع صاحب الحساب هو من يحدّد أين تُسجَّل قيمة مخزونه (مثلاً مستودع محطة على حساب مخزون المحطة)، فكل حركة
 * تمسّ قيمة مخزونه — شراء، بيع (تكلفة)، إدخال/إخراج، صرف، تحويل، صرف وقود الورديات — تأخذ الحساب من هنا لا من الصنف.
 * المستودعات القديمة بلا حساب تبقى على حساب الصنف كما كانت، فلا يتغيّر ترحيل أي قائم.
 *
 * لا ينطبق على أصناف المصروف (expenseAccountId) ولا الجرد الدوري (purchasesAccountId): حسابها ليس حساب مخزون أصلاً.
 */
export function stockAccountFor(item: { stockAccountId: string | null }, warehouse: { stockAccountId: string | null } | null | undefined): string | null {
  return warehouse?.stockAccountId ?? item.stockAccountId;
}
