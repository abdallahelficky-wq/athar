import { z } from "zod";
import { salesInvoiceLineSchema } from "../salesInvoices/salesInvoices.schemas";

export const posPaymentSchema = z.object({
  method: z.enum(["cash", "bank"]),
  amount: z.coerce.number().positive(),
  bankAccountId: z.string().optional(),
});

export const createPosSaleSchema = z.object({
  companyId: z.string().min(1),
  // اختياري لبيع مدفوع فوراً (يُستخدَم "عميل نقدي" المزروع تلقائياً لكل شركة جديدة —
  // starterData.ts)؛ إلزامي فعلياً للبيع الآجل (بلا دفعات) — يُتحقَّق منه في pos.service.ts، لا هنا،
  // لأن هذا الحقل نفسه يبقى optional دائماً وشرطه الحقيقي مرتبط بحالة payments.
  customerId: z.string().optional(),
  // لا حقل "date" هنا عمداً: تاريخ إصدار فاتورة نقطة البيع يجب أن يكون وقت الخادم الفعلي دائماً
  // بلا أي استثناء (لا يجوز تأخير الإصدار فعلياً) — أي "date" يُرسِله العميل يُسقَط بصمت هنا (سلوك
  // z.object الافتراضي هو تجاهل الحقول غير المعرَّفة)، ولا يصل إطلاقاً إلى pos.service.ts. راجع
  // supplyDate أدناه للحالة المدعومة فعلياً (تسجيل زيارة ميدانية لاحقاً بتاريخها الحقيقي).
  // تاريخ التوريد/التسليم الفعلي — منفصل تماماً عن تاريخ الإصدار، يبقى اختيارياً ويتساوى معه
  // افتراضياً؛ كل التحقق (لا تواريخ مستقبلية، حد التراجع، الفترة المُقفلة) في pos.service.ts.
  supplyDate: z.coerce.date().optional(),
  lines: z.array(salesInvoiceLineSchema).min(1),
  // مصفوفة فارغة = بيع آجل (على حساب العميل، بلا أي دفعة الآن) — حالة مقصودة ومدعومة، وليست
  // بيانات ناقصة. pos.service.ts يتخطى تحقّق "تطابق مجموع الدفعات مع الإجمالي" فقط في هذه الحالة.
  payments: z.array(posPaymentSchema).min(0),
  // المستودع المرتبط بجهاز نقطة البيع هذا (يُحفَظ محلياً على كل جهاز) — اختياري هنا فقط لأن
  // الشركات ذات المستودع الواحد تُحل تلقائياً بلا اختيار؛ التحقق الفعلي في pos.service.ts.
  warehouseId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
}).refine(
  (data) => data.payments.length > 0 || data.dueDate != null,
  { message: "البيع الآجل (بلا أي دفعة) يتطلب تحديد تاريخ استحقاق", path: ["dueDate"] },
);

export const addPosFavoriteItemSchema = z.object({
  companyId: z.string().min(1),
  warehouseId: z.string().min(1),
  itemId: z.string().min(1),
});
