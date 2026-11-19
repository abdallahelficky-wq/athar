import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "صيغة الشهر يجب أن تكون YYYY-MM");
const amount = z.coerce.number().positive("مبلغ الدفعة يجب أن يكون أكبر من صفر");
const everyMonths = z.coerce.number().int("دورية السداد عدد صحيح من الأشهر").min(1, "دورية السداد شهر واحد على الأقل").max(120, "دورية السداد لا تتجاوز 120 شهراً");
const vatMode = z.enum(["none", "inclusive"]);
const noticeDays = z.coerce.number().int("مهلة الإشعار عدد صحيح من الأيام").min(0, "مهلة الإشعار لا تكون سالبة").max(3650, "مهلة الإشعار لا تتجاوز 3650 يوماً");
const text = z.string().max(300).nullable().optional();
// بيانات وصفية للمؤجر والعقار — مفاتيح محددة فقط (strict) حتى لا يُخزَّن في العمود ما لا تعرضه الشاشة
const lessorDetails = z
  .object({ type: z.enum(["company", "individual"]).nullable().optional(), idNumber: text, crNumber: text, unifiedNumber: text, vatNumber: text, representative: text, representativeId: text, mobile: text, email: text, address: text, iban: text })
  .strict();
// رابط الموقع على الخريطة: http(s) فقط — يُعرَض رابطاً في الشاشة فلا يُقبَل javascript: ولا غيره
const mapUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "رابط الموقع يجب أن يبدأ بـ https://")
  .nullable()
  .optional();
const propertyDetails = z.object({ address: text, city: text, unitType: text, area: text, deedNumber: text, mapUrl }).strict();
export const LEASE_CATEGORIES = ["fuel_station", "car_wash", "shop_restaurant", "office", "staff_housing", "warehouse", "land", "other"] as const;
const contractDetails = {
  contractNumber: z.string().max(60).nullable().optional(),
  contractValue: z.coerce.number().nonnegative().nullable().optional(),
  depositAmount: z.coerce.number().nonnegative().nullable().optional(),
  customTerms: z.string().max(6000).nullable().optional(),
  autoRenew: z.boolean().optional(),
  noticeDays: noticeDays.nullable().optional(),
  lessorDetails: lessorDetails.nullable().optional(),
  propertyDetails: propertyDetails.nullable().optional(),
  direction: z.enum(["lessee", "lessor"]).optional(),
  category: z.enum(LEASE_CATEGORIES).nullable().optional(),
};

export const createLeaseContractSchema = z.object({
  companyId: z.string(),
  title: z.string().min(2, "اسم/عنوان عقد الإيجار قصير جداً"),
  counterparty: z.string().nullable().optional(),
  monthlyRent: z.number().nonnegative().nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  notes: z.string().nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  vatMode: vatMode.optional(),
  paymentAmount: amount.nullable().optional(),
  paymentEveryMonths: everyMonths.nullable().optional(),
  firstDueDate: z.coerce.date().nullable().optional(),
  expenseAccountId: z.string().min(1).nullable().optional(),
  prepaidAccountId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  signedOn: z.coerce.date().nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
  ...contractDetails,
});

export const updateLeaseContractSchema = createLeaseContractSchema.partial();

const brandColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "لون العلامة التجارية بصيغة #RRGGBB").nullable().optional();
export const createBrandSchema = z
  .object({
    companyId: z.string().min(1),
    name: z.string().trim().min(2, "اسم العلامة التجارية قصير جداً").max(80, "اسم العلامة التجارية أطول من المسموح"),
    nameEn: z.string().trim().max(80).nullable().optional(),
    color: brandColor,
  })
  .strict();
export const updateBrandSchema = z
  .object({
    name: z.string().trim().min(2, "اسم العلامة التجارية قصير جداً").max(80, "اسم العلامة التجارية أطول من المسموح").optional(),
    nameEn: z.string().trim().max(80).nullable().optional(),
    color: brandColor,
    isActive: z.boolean().optional(),
  })
  .strict();

export const noticePreviewSchema = z.object({ kind: z.enum(["renewal", "termination"]) }).strict();
export const createNoticeSchema = z
  .object({
    kind: z.enum(["renewal", "termination"]),
    subject: z.string().trim().min(5, "موضوع الخطاب قصير جداً").max(300, "موضوع الخطاب أطول من المسموح"),
    body: z.string().trim().min(20, "نص الخطاب قصير جداً").max(10000, "نص الخطاب أطول من المسموح"),
    recipientEmails: z.array(z.string().trim().email("بريد إلكتروني غير صالح في قائمة المستلمين")).max(20, "عدد المستلمين أكبر من المسموح"),
    send: z.boolean().optional(),
  })
  .strict();

export const contractStatusSchema = z
  .object({
    status: z.enum(["active", "suspended", "stopped", "ended"]),
    reason: z.string().trim().max(1000, "سبب تغيير حالة العقد أطول من المسموح").nullable().optional(),
    effectiveDate: day.optional(),
  })
  .strict();

export const applyAccountsSchema = z
  .object({
    companyId: z.string().min(1),
    expenseAccountId: z.string().min(1).nullable().optional(),
    prepaidAccountId: z.string().min(1).nullable().optional(),
    onlyMissing: z.boolean().optional(),
    direction: z.enum(["lessee", "lessor"]).optional(),
  })
  .strict();

export const generateScheduleSchema = z.object({ until: day.optional() }).strict();

export const createPaymentSchema = z
  .object({
    leaseContractId: z.string().min(1),
    dueDate: day,
    periodFrom: day,
    periodTo: day,
    amount,
    status: z.enum(["due", "waived"]).optional(),
    note: z.string().nullable().optional(),
  })
  .strict();

export const updatePaymentSchema = z
  .object({
    dueDate: day.optional(),
    periodFrom: day.optional(),
    periodTo: day.optional(),
    amount: amount.optional(),
    status: z.enum(["due", "waived"]).optional(),
    note: z.string().nullable().optional(),
  })
  .strict();

export const confirmPaymentSchema = z
  .object({
    paidOn: day,
    bankAccountId: z.string().min(1).optional(),
    amount: amount.optional(),
    reference: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    postedExternally: z.boolean().optional(),
    amortizeFromMonth: month.nullable().optional(),
  })
  .strict();

export const reversePaymentSchema = z.object({ reason: z.string().trim().min(1, "السبب مطلوب"), date: day.optional() }).strict();

export const postAmortizationSchema = z.object({ companyId: z.string().min(1), month }).strict();

export const removeAmortizationSchema = z.object({ pin: z.string().min(1, "الرقم السري مطلوب") }).strict();

export const importSchema = z
  .object({
    companyId: z.string().min(1),
    contracts: z
      .array(
        z
          .object({
            title: z.string().trim().min(2, "اسم/عنوان عقد الإيجار قصير جداً"),
            counterparty: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
            vatMode,
            startDate: day,
            endDate: day,
            costCenterName: z.string().nullable().optional(),
            paymentAmount: amount.nullable().optional(),
            paymentEveryMonths: everyMonths.nullable().optional(),
            firstDueDate: day.nullable().optional(),
            isActive: z.boolean().optional(),
            signedOn: day.nullable().optional(),
            ...contractDetails,
            payments: z
              .array(
                z
                  .object({
                    dueDate: day,
                    periodFrom: day,
                    periodTo: day,
                    amount,
                    status: z.enum(["due", "waived", "paid_external"]).optional(),
                    paidOn: day.nullable().optional(),
                    amortizeFromMonth: month.nullable().optional(),
                    note: z.string().nullable().optional(),
                  })
                  .strict(),
              )
              .max(600, "عدد دفعات العقد أكبر من المسموح في استيراد واحد"),
          })
          .strict(),
      )
      .min(1, "ملف الاستيراد لا يحتوي عقوداً")
      .max(500, "عدد العقود أكبر من المسموح في استيراد واحد"),
  })
  .strict();

export const reminderSettingSchema = z
  .object({
    companyId: z.string().min(1),
    enabled: z.boolean(),
    hourKsa: z.coerce.number().int("ساعة الإرسال عدد صحيح بين 0 و23").min(0, "ساعة الإرسال عدد صحيح بين 0 و23").max(23, "ساعة الإرسال عدد صحيح بين 0 و23"),
    minuteKsa: z.coerce.number().int("دقيقة الإرسال عدد صحيح بين 0 و59").min(0, "دقيقة الإرسال عدد صحيح بين 0 و59").max(59, "دقيقة الإرسال عدد صحيح بين 0 و59").default(0),
    recipientEmails: z.array(z.string().trim().email("بريد إلكتروني غير صالح في قائمة المستلمين")).max(20, "عدد المستلمين أكبر من المسموح"),
  })
  .strict();

export const sendReminderSchema = z.object({ companyId: z.string().min(1) }).strict();
