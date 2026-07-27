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

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function mimeToAnthropicMediaType(mimeType: string): string {
  if (mimeType === "application/pdf") return "application/pdf";
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)) return mimeType;
  // زاتكا ومعظم أنظمة المسح الضوئي تُصدر JPEG/PNG أو PDF؛ أي نوع آخر غير مدعوم من قدرة الرؤية
  throw badRequest("نوع الملف غير مدعوم لقراءة المستند بالذكاء الاصطناعي — استخدم صورة (JPG/PNG) أو ملف PDF");
}

function documentBlockFor(buffer: Buffer, mimeType: string) {
  const mediaType = mimeToAnthropicMediaType(mimeType);
  return mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } };
}

/**
 * يستدعي Anthropic Messages API عبر Tool Use (function calling) بدل تقنية الـ "assistant
 * message prefill" المستخدَمة سابقاً — بعض النماذج (خصوصاً ذات extended thinking) ترفض
 * الطلب بالكامل بخطأ 400 لو انتهت المحادثة برسالة "assistant" ("This model does not support
 * assistant message prefill")، بينما Tool Use مدعوم على نطاق واسع ولا يعتمد على انتهاء
 * المحادثة برسالة معيّنة، ويُعيد JSON مُوثَّقاً بالفعل (`tool_use.input`) دون أي حاجة لتحليل
 * نص خام أو تنظيفه من ```json``` محتملة.
 */
async function callAnthropicVisionTool(
  documentBlock: Record<string, unknown>,
  promptText: string,
  tool: AnthropicTool,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${env.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicApiKey!,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: [documentBlock, { type: "text", text: promptText }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`فشل استدعاء نموذج الذكاء الاصطناعي (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; input?: Record<string, unknown> }>;
  };
  const toolUseBlock = payload.content?.find((b) => b.type === "tool_use");
  if (!toolUseBlock?.input) {
    throw badRequest("تعذّر على الذكاء الاصطناعي قراءة هذا المستند بصيغة منظّمة، جرّب صورة أوضح");
  }
  return toolUseBlock.input;
}

/** نص فارغ من النموذج يعني "غير معروف" — يُحوَّل إلى null بدل الاحتفاظ به كسلسلة فارغة */
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function buildJournalEntryPrompt(accounts: AccountOption[]): string {
  const accountsList = accounts.map((a) => `- id: "${a.id}" — الاسم: "${a.name}" — النوع: ${a.type}`).join("\n");
  return `أنت محاسب خبير تراجع مستنداً مالياً (فاتورة، حوالة بنكية، إيصال دفع، أو ما شابه) لمنشأة سعودية.

اقرأ المستند المرفق بعناية، ثم استخدم الأداة المتاحة لتسجيل البيانات المستخرجة:
- date: تاريخ المستند بصيغة YYYY-MM-DD (أو نص فارغ إن لم يكن واضحاً)
- description: وصف موجز للمعاملة بالعربية (سطر واحد)
- party_name: اسم الطرف الآخر (المورد/العميل/البنك) إن ظهر، وإلا نص فارغ
- amount: المبلغ الإجمالي للمستند (رقم فقط، شامل الضريبة إن وُجدت)
- vat_amount: مبلغ ضريبة القيمة المضافة إن ظهر بوضوح في المستند، وإلا 0
- confidence_note: ملاحظة موجزة بالعربية عن مدى وضوح المستند وأي شك في القراءة

اختر **من شجرة الحسابات الفعلية التالية لهذه المنشأة فقط** أنسب حساب مدين وأنسب حساب دائن لهذه
المعاملة (suggested_debit_account_id/suggested_credit_account_id مُقيَّدان بالفعل بهذه القائمة):

${accountsList}`;
}

function journalEntryTool(accounts: AccountOption[]): AnthropicTool {
  const accountIds = accounts.map((a) => a.id);
  return {
    name: "record_journal_entry_extraction",
    description: "يسجّل بيانات القيد المحاسبي المستخرجة من المستند المالي المرفق",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD أو نص فارغ" },
        description: { type: "string" },
        party_name: { type: "string", description: "نص فارغ إن لم يظهر" },
        amount: { type: "number" },
        vat_amount: { type: "number" },
        suggested_debit_account_id: { type: "string", enum: accountIds },
        suggested_credit_account_id: { type: "string", enum: accountIds },
        confidence_note: { type: "string" },
      },
      required: [
        "description",
        "amount",
        "vat_amount",
        "suggested_debit_account_id",
        "suggested_credit_account_id",
        "confidence_note",
      ],
    },
  };
}

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

  const documentBlock = documentBlockFor(buffer, mimeType);
  const parsed = await callAnthropicVisionTool(documentBlock, buildJournalEntryPrompt(accounts), journalEntryTool(accounts));

  return {
    date: strOrNull(parsed.date),
    description: typeof parsed.description === "string" ? parsed.description : "",
    partyName: strOrNull(parsed.party_name),
    suggestedDebitAccountId: strOrNull(parsed.suggested_debit_account_id),
    suggestedCreditAccountId: strOrNull(parsed.suggested_credit_account_id),
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

const COMPANY_DOC_PROMPTS: Record<CompanyDocType, { intro: string; fieldKeys: string[] }> = {
  cr: {
    intro: "أنت تراجع صورة/ملف سجل تجاري سعودي.",
    fieldKeys: ["name", "shortName", "crNumber", "crIssueDate", "crExpiryDate"],
  },
  national_address: {
    intro: "أنت تراجع صورة/ملف شهادة العنوان الوطني السعودي.",
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
    fieldKeys: ["vatNumber", "name"],
  },
};

function buildCompanyPrompt(docType: CompanyDocType): string {
  const spec = COMPANY_DOC_PROMPTS[docType];
  return `${spec.intro} اقرأ المستند المرفق بعناية، ثم استخدم الأداة المتاحة لتسجيل الحقول المرتبطة
بهذا النوع من المستندات فقط (${spec.fieldKeys.join(", ")}).

إن كان أي حقل غير مقروء أو غير موجود في المستند، أرسل نصاً فارغاً بدلاً من تخمين قيمة.
قيّم مدى وضوح المستند بصدق في confidence ("low" لو المستند غير واضح، مقصوص، أو ليس نوع
المستند المطلوب أصلاً)، واشرح السبب باختصار بالعربية في confidence_note.`;
}

function companyDocTool(docType: CompanyDocType): AnthropicTool {
  const spec = COMPANY_DOC_PROMPTS[docType];
  const properties: Record<string, unknown> = {};
  for (const key of spec.fieldKeys) {
    properties[key] = { type: "string", description: "نص فارغ إن لم يكن مقروءاً" };
  }
  properties.confidence = { type: "string", enum: ["high", "low"] };
  properties.confidence_note = { type: "string" };

  return {
    name: "record_company_document_extraction",
    description: "يسجّل بيانات الشركة الرسمية المستخرجة من المستند المرفق",
    input_schema: {
      type: "object",
      properties,
      required: ["confidence", "confidence_note"],
    },
  };
}

/** نفس منطق extractJournalEntryFromDocument تماماً (Tool Use)، لكن لاستخراج بيانات الشركة الرسمية بدل سطور القيد */
export async function extractCompanyDataFromDocument(
  buffer: Buffer,
  mimeType: string,
  docType: CompanyDocType,
): Promise<CompanyDataExtraction> {
  if (!env.anthropicApiKey) {
    throw new Error("ميزة استخراج بيانات الشركة من المستندات غير مُفعّلة: ANTHROPIC_API_KEY غير مضبوط");
  }

  const documentBlock = documentBlockFor(buffer, mimeType);
  const parsed = await callAnthropicVisionTool(documentBlock, buildCompanyPrompt(docType), companyDocTool(docType));

  const fields: Record<string, string> = {};
  for (const key of COMPANY_DOC_PROMPTS[docType].fieldKeys) {
    const value = strOrNull(parsed[key]);
    if (value) fields[key] = value;
  }

  return {
    fields,
    confidence: parsed.confidence === "low" ? "low" : "high",
    confidenceNote: typeof parsed.confidence_note === "string" ? parsed.confidence_note : "",
  };
}
