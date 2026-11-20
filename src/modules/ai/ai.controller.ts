import { RequestHandler } from "express";
import { askAtharAi } from "./ai.service";
import { buildFinancialContext, findRecentDuplicates, loadSignals, resolveAiScope } from "./financialContext";
import { z } from "zod";

const scopeFields = {
  companyId: z.string().trim().min(1).max(200).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
};

const askSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  }).strict()).max(10).optional(),
  ...scopeFields,
}).strict();

const insightsSchema = z.object(scopeFields).strict();
const signalsSchema = z.object({ companyId: scopeFields.companyId }).strict();

/** مهمة التحليل الدوري — يحدّدها الخادم فقط، لا يستطيع المستخدم تعديلها. */
const INSIGHTS_TASK = `مهمتك الآن: تحليل مالي دوري للمدير المالي، بهذه الأقسام بالترتيب وبعناوين قصيرة:
١) الخلاصة: ثلاثة أسطر كحد أقصى عن وضع الأداء والسيولة.
٢) أهم المخاطر: حتى ثلاثة، كل خطر برقم داعم من البيانات وفترته.
٣) إجراءات مقترحة: حتى ثلاثة إجراءات عملية قابلة للتنفيذ.
٤) التوقعات والشذوذ: علّق على signals.forecasts وsignals.anomalies وبيّن مستوى الثقة؛ وإن لم تتوفر بيانات كافية فاذكر ذلك صراحةً.
اذكر المبالغ بعملة الشركة دون اختراع عملة، ولا تتجاوز 350 كلمة.`;
const INSIGHTS_QUESTION = "قدّم التحليل المالي الدوري.";

export const askAiHandler: RequestHandler = async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: only question, history, companyId, dateFrom and dateTo are accepted" });
    return;
  }
  const scope = await resolveAiScope(req, parsed.data);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  const context = await buildFinancialContext(scope, req.lang);
  const result = await askAtharAi(parsed.data.question, context, { history: parsed.data.history });
  res.json({ ...result, scope: context.scope });
};

export const insightsHandler: RequestHandler = async (req, res) => {
  const parsed = insightsSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid request: only companyId, dateFrom and dateTo are accepted" }); return; }
  const scope = await resolveAiScope(req, parsed.data);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  const [context, duplicates] = await Promise.all([
    buildFinancialContext(scope, req.lang),
    findRecentDuplicates(scope.tenantId, scope.companyId),
  ]);
  const result = await askAtharAi(INSIGHTS_QUESTION, { ...context, possibleDuplicateEntries: duplicates }, { task: INSIGHTS_TASK });
  res.json({ ...result, scope: context.scope });
};

/** توقعات وشذوذ حتمية بلا نموذج لغوي — لا تكلفة ولا إرسال بيانات لمزوّد خارجي. */
export const signalsHandler: RequestHandler = async (req, res) => {
  const parsed = signalsSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request: only companyId is accepted" }); return; }
  const scope = await resolveAiScope(req, parsed.data);
  if (!scope.ok) { res.status(scope.status).json({ error: scope.error }); return; }
  const [signals, duplicates] = await Promise.all([
    loadSignals(scope.tenantId, scope.companyId),
    findRecentDuplicates(scope.tenantId, scope.companyId),
  ]);
  res.json({ scope: { companyId: scope.companyId ?? "all" }, ...signals, duplicates });
};
