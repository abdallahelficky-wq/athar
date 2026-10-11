import { RequestHandler } from "express";
import { assertRecordCompanyScope } from "../../middleware/auth";
import { notFound } from "../httpError";
import type { ZatcaArchiveDocumentType } from "./archive";
import { getZatcaAttemptSignedXml, getZatcaDocumentHistory } from "./issues";

type ScopedModel = Parameters<typeof assertRecordCompanyScope>[1];

/** سجل إصدارات زاتكا ومحاولات الإرسال لمستند واحد، وتنزيل ملف XML الموقَّع لمحاولة بعينها — نفس نطاق المستأجر والشركة
 * لقراءة المستند نفسه (assertRecordCompanyScope + tenantId في كل استعلام بـissues.ts). */
export function zatcaHistoryHandlers(documentType: ZatcaArchiveDocumentType, model: ScopedModel) {
  // مستند خارج المستأجر = 404 (لا قائمة فارغة توحي بوجوده)، ثم نطاق الشركة
  const assertScope = async (auth: NonNullable<Parameters<RequestHandler>[0]["auth"]>, id: string) => {
    const doc = await model.findFirst({ where: { id, tenantId: auth.tenantId }, select: { companyId: true } });
    if (!doc) throw notFound("المستند غير موجود");
    await assertRecordCompanyScope(auth, model, id);
  };
  const history: RequestHandler = async (req, res) => {
    await assertScope(req.auth!, req.params.id);
    res.json(await getZatcaDocumentHistory(req.auth!.tenantId, documentType, req.params.id));
  };
  const attemptXml: RequestHandler = async (req, res) => {
    await assertScope(req.auth!, req.params.id);
    const { xml, fileName } = await getZatcaAttemptSignedXml(req.auth!.tenantId, documentType, req.params.id, req.params.attemptId);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
    res.send(xml);
  };
  return { history, attemptXml };
}
