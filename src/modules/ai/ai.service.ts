type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `أنت مساعد أثر المالي الذكي داخل نظام أثر المحاسبي.
مهمتك شرح وتحليل البيانات المالية التي يرسلها لك النظام فقط.
لا تخترع أرقاماً أو قيوداً أو مستندات غير موجودة في السياق.
إذا لم تتوفر بيانات كافية، اذكر ذلك بوضوح.
هذه النسخة للقراءة والتحليل فقط: لا تطلب ولا تدّعي تنفيذ إنشاء أو تعديل أو حذف أي بيانات محاسبية.
أجب بالعربية ما لم يطلب المستخدم لغة أخرى.`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function askAtharAi(question: string, context?: unknown) {
  const gatewayId = requiredEnv("CLOUDFLARE_AI_GATEWAY_ID");
  const gatewayToken = requiredEnv("CLOUDFLARE_AI_GATEWAY_TOKEN");
  const model = process.env.ATHAR_AI_MODEL || "openai/gpt-4.1-mini";

  const messages: AiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: context === undefined
        ? question
        : `${question}\n\nبيانات من نظام أثر (للقراءة فقط):\n${JSON.stringify(context)}`,
    },
  ];

  const response = await fetch(
    `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(gatewayId)}/compat/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 800 }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Athar AI Gateway request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = (await response.json()) as any;
  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Athar AI returned an empty response");
  }

  return { answer: answer.trim(), model };
}
