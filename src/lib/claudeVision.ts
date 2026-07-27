import { env } from "../config/env";
import { badRequest } from "./httpError";

const ANTHROPIC_VERSION = "2023-06-01";

export interface AccountOption {
  id: string;
  name: string;
  type: string;
}

export interface DocumentExtraction {
  date: string | null;
  description: string;
  partyName: string | null;
  suggestedDebitAccountId: string | null;
  suggestedCreditAccountId: string | null;
  amount: number;
  vatAmount: number;
  confidenceNote: string;
}

function mimeToAnthropicMediaType(mimeType: string): string {
  if (mimeType === "application/pdf") return "application/pdf";
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)) return mimeType;
  // زاتكا ومعظم أنظمة المسح الضوئي تُصدر JPEG/PNG أو PDF؛ أي نوع آخر غير مدعوم من قدرة الرؤية
  throw badRequest("نوع الملف غير مدعوم لقراءة المستند بالذكاء الاصطناعي — استخدم صورة (JPG/PNG) أو ملف PDF");
}

function buildPrompt(accounts: AccountOption[]): string {
  const accountsList = accounts.map((a) => `- id: "${a.id}" — الاسم: "${a.name}" — النوع: ${a.type}`).join("\n");

  return `أنت محاسب خبير تراجع مستنداً مالياً (فاتورة، حوالة بنكية، إيصال دفع، أو ما شابه) لمنشأة سعودية.

اقرأ المستند المرفق بعناية واستخرج البيانات التالية:
- date: تاريخ المستند بصيغة YYYY-MM-DD (أو null إن لم يكن واضحاً)
- description: وصف موجز للمعاملة بالعربية (سطر واحد)
- party_name: اسم الطرف الآخر (المورد/العميل/البنك) إن ظهر، وإلا null
- amount: المبلغ الإجمالي للمستند (رقم فقط، شامل الضريبة إن وُجدت)
- vat_amount: مبلغ ضريبة القيمة المضافة إن ظهر بوضوح في المستند، وإلا 0
- confidence_note: ملاحظة موجزة بالعربية عن مدى وضوح المستند وأي شك في القراءة

بعد ذلك، اختر **من شجرة الحسابات الفعلية التالية لهذه المنشأة فقط** (ولا تخترع أي حساب غير موجود
في هذه القائمة) أنسب حساب مدين وأنسب حساب دائن لهذه المعاملة، واستخدم قيمة id بالضبط كما هي:

${accountsList}

- suggested_debit_account_id: قيمة id للحساب المدين المقترح من القائمة أعلاه
- suggested_credit_account_id: قيمة id للحساب الدائن المقترح من القائمة أعلاه

أجب **فقط** بكائن JSON واحد بالضبط بهذا الشكل، بدون أي نص أو شرح أو markdown قبله أو بعده:
{"date": "...", "description": "...", "party_name": "...", "amount": 0, "vat_amount": 0, "suggested_debit_account_id": "...", "suggested_credit_account_id": "...", "confidence_note": "..."}`;
}

function extractJsonBlock(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw badRequest("تعذّر على الذكاء الاصطناعي قراءة هذا المستند بصيغة منظّمة، جرّب صورة أوضح");
  }
  return text.slice(start, end + 1);
}

/**
 * يستدعي Anthropic Messages API (قدرة الرؤية) لقراءة مستند مالي واقتراح قيد محاسبي.
 * يستخدم تقنية الـ prefill (بدء رد المساعد بـ "{") لإجبار النموذج على إخراج JSON خالص
 * دون أي نص إضافي، بدل الاعتماد فقط على التوجيه النصي في الـ prompt.
 */
export async function extractJournalEntryFromDocument(
  buffer: Buffer,
  mimeType: string,
  accounts: AccountOption[],
): Promise<DocumentExtraction> {
  if (!env.anthropicApiKey) {
    throw new Error("ميزة إنشاء القيود من المستندات غير مُفعّلة: ANTHROPIC_API_KEY غير مضبوط");
  }
  if (accounts.length === 0) {
    throw badRequest("لا توجد حسابات في شجرة حسابات هذه الشركة بعد");
  }

  const mediaType = mimeToAnthropicMediaType(mimeType);
  const documentBlock =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } };

  const response = await fetch(`${env.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [documentBlock, { type: "text", text: buildPrompt(accounts) }],
        },
        { role: "assistant", content: "{" },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`فشل استدعاء نموذج الذكاء الاصطناعي (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const textBlock = payload.content?.find((b) => b.type === "text")?.text ?? "";
  // نعيد "{" التي بدأنا بها رد المساعد (prefill) لأن النموذج يكمل من بعدها ولا يكررها
  const raw = "{" + textBlock;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonBlock(raw));
  } catch {
    throw badRequest("تعذّر على الذكاء الاصطناعي قراءة هذا المستند بصيغة منظّمة، جرّب صورة أوضح");
  }

  return {
    date: typeof parsed.date === "string" ? parsed.date : null,
    description: typeof parsed.description === "string" ? parsed.description : "",
    partyName: typeof parsed.party_name === "string" ? parsed.party_name : null,
    suggestedDebitAccountId: typeof parsed.suggested_debit_account_id === "string" ? parsed.suggested_debit_account_id : null,
    suggestedCreditAccountId: typeof parsed.suggested_credit_account_id === "string" ? parsed.suggested_credit_account_id : null,
    amount: Number(parsed.amount) || 0,
    vatAmount: Number(parsed.vat_amount) || 0,
    confidenceNote: typeof parsed.confidence_note === "string" ? parsed.confidence_note : "",
  };
}

// ---------------------------------------------------------------------------
// استخراج بيانات الشركة الرسمية من المستندات (سجل تجاري / عنوان وطني / شهادة ضريبة)
// ---------------------------------------------------------------------------

export type CompanyDocType = "cr" | "national_address" | "vat_certificate";

export interface CompanyDataExtraction {
  fields: Record<string, string>;
  confidence: "high" | "low";
  confidenceNote: string;
}

const COMPANY_DOC_PROMPTS: Record<CompanyDocType, { intro: string; shape: string; fieldKeys: string[] }> = {
  cr: {
    intro: "أنت تراجع صورة/ملف سجل تجاري سعودي.",
    shape:
      '{"name": "...", "shortName": "...", "crNumber": "...", "crIssueDate": "YYYY-MM-DD"|null, "crExpiryDate": "YYYY-MM-DD"|null, "confidence": "high"|"low", "confidenceNote": "..."}',
    fieldKeys: ["name", "shortName", "crNumber", "crIssueDate", "crExpiryDate"],
  },
  national_address: {
    intro: "أنت تراجع صورة/ملف شهادة العنوان الوطني السعودي.",
    shape:
      '{"addressBuilding": "...", "addressStreet": "...", "addressDistrict": "...", "addressCity": "...", "addressPostalCode": "...", "addressAdditionalNo": "...", "confidence": "high"|"low", "confidenceNote": "..."}',
    fieldKeys: [
      "addressBuilding",
      "addressStreet",
      "addressDistrict",
      "addressCity",
      "addressPostalCode",
      "addressAdditionalNo",
    ],
  },
  vat_certificate: {
    intro: "أنت تراجع صورة/ملف شهادة تسجيل ضريبة القيمة المضافة (زاتكا) السعودية.",
    shape: '{"vatNumber": "...", "name": "...", "confidence": "high"|"low", "confidenceNote": "..."}',
    fieldKeys: ["vatNumber", "name"],
  },
};

function buildCompanyPrompt(docType: CompanyDocType): string {
  const spec = COMPANY_DOC_PROMPTS[docType];
  return `${spec.intro} اقرأ المستند المرفق بعناية واستخرج فقط الحقول المرتبطة به.

إن كان أي حقل غير مقروء أو غير موجود في المستند، استخدم null بدلاً من تخمين قيمة.
قيّم مدى وضوح المستند بصدق في confidence ("low" لو المستند غير واضح، مقصوص، أو مش نوع
المستند المطلوب أصلاً)، واشرح السبب باختصار بالعربية في confidenceNote.

أجب **فقط** بكائن JSON واحد بالضبط بهذا الشكل، بدون أي نص أو شرح أو markdown قبله أو بعده:
${spec.shape}`;
}

/** نفس منطق extractJournalEntryFromDocument تماماً، لكن لاستخراج بيانات الشركة الرسمية بدل سطور القيد */
export async function extractCompanyDataFromDocument(
  buffer: Buffer,
  mimeType: string,
  docType: CompanyDocType,
): Promise<CompanyDataExtraction> {
  if (!env.anthropicApiKey) {
    throw new Error("ميزة استخراج بيانات الشركة من المستندات غير مُفعّلة: ANTHROPIC_API_KEY غير مضبوط");
  }

  const mediaType = mimeToAnthropicMediaType(mimeType);
  const documentBlock =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } };

  const response = await fetch(`${env.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [documentBlock, { type: "text", text: buildCompanyPrompt(docType) }],
        },
        { role: "assistant", content: "{" },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`فشل استدعاء نموذج الذكاء الاصطناعي (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const textBlock = payload.content?.find((b) => b.type === "text")?.text ?? "";
  const raw = "{" + textBlock;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonBlock(raw));
  } catch {
    throw badRequest("تعذّر على الذكاء الاصطناعي قراءة هذا المستند بصيغة منظّمة، جرّب صورة أوضح");
  }

  const fields: Record<string, string> = {};
  for (const key of COMPANY_DOC_PROMPTS[docType].fieldKeys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) fields[key] = value.trim();
  }

  return {
    fields,
    confidence: parsed.confidence === "low" ? "low" : "high",
    confidenceNote: typeof parsed.confidenceNote === "string" ? parsed.confidenceNote : "",
  };
}
