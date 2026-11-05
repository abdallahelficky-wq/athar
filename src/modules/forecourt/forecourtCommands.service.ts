import { Prisma, type ForecourtCommandType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { PtsOfflineError, PtsTimeoutError, sendPtsRequest } from "./ptsWebsocket";

/**
 * أوامر المضخات من أثر إلى PTS-2 عبر الاتصال الدائم (المواصفة R140: PumpAuthorize ص187، PumpAuthorizeConfirmation ص190، PumpStop
 * ص195، PumpEmergencyStop ص196). كل أمر يُسجَّل قبل إرساله ثم تُحدَّث حالته برد الجهاز — سجل تدقيق كامل لمن شغّل أي مضخة وبكم.
 *
 * التشغيل (PumpAuthorize) يحدد للجهاز مضخة وفوهة (اختيارية: بدونها تُشغَّل أول فوهة تُرفع إن كانت الأصناف معرّفة في الجهاز) ونوع
 * الحد: مبلغ (Amount) أو لترات (Volume) أو تعبئة كاملة (FullTank). السعر اختياري: بدونه يطبّق الجهاز سعر الصنف المضبوط فيه.
 * CustomData يحمل رقم الأمر في أثر، فيعود مع عملية البيع المرفوعة لاحقاً (UploadPumpTransaction) ويربطها بهذا الأمر.
 *
 * الأرقام هنا أرقام المضخة والفوهة في الجهاز نفسه (ptsPump/ptsNozzle) — نفس أرقام جدول ربط الفوهات.
 */

export const PRESET_TYPES = ["Amount", "Volume", "FullTank"] as const;
export type PresetType = (typeof PRESET_TYPES)[number];

export interface AuthorizeInput {
  ptsPump: number;
  ptsNozzle?: number | null;
  presetType: PresetType;
  dose?: number | null;
  price?: number | null;
}

async function controllerInTenant(tenantId: string, controllerId: string) {
  const c = await prisma.forecourtController.findFirst({ where: { id: controllerId, tenantId } });
  if (!c) throw notFound("المتحكم غير موجود");
  if (!c.isActive) throw badRequest("المتحكم موقوف — فعّله أولاً لإرسال الأوامر");
  return c;
}

type Reply = { Type?: unknown; Error?: unknown; Code?: unknown; Message?: unknown; Data?: unknown };

/** يرسل الطلب ويحدّث صف الأمر بنتيجته — لا يرمي عند رفض الجهاز أو انقطاعه، فالنتيجة نفسها جزء من السجل. */
async function dispatch(commandId: string, controllerId: string, requestType: string, data: Record<string, unknown>) {
  let update: Prisma.ForecourtCommandUpdateInput;
  try {
    const reply = (await sendPtsRequest(controllerId, requestType, data)) as Reply;
    const replyData = (reply.Data && typeof reply.Data === "object" ? reply.Data : {}) as Record<string, unknown>;
    if (reply.Error === true) {
      update = {
        status: "rejected", errorCode: typeof reply.Code === "number" ? reply.Code : null,
        errorMessage: typeof reply.Message === "string" ? reply.Message : null,
      };
    } else {
      update = { status: "confirmed", transactionNumber: typeof replyData.Transaction === "number" ? replyData.Transaction : null };
    }
    update.responsePayload = reply as Prisma.InputJsonValue;
  } catch (err) {
    if (err instanceof PtsOfflineError) update = { status: "offline", errorMessage: "CONTROLLER_OFFLINE" };
    else if (err instanceof PtsTimeoutError) update = { status: "timeout", errorMessage: "NO_RESPONSE" };
    else throw err;
  }
  return prisma.forecourtCommand.update({ where: { id: commandId }, data: { ...update, respondedAt: new Date() } });
}

async function createCommand(
  c: { id: string; tenantId: string; companyId: string },
  type: ForecourtCommandType,
  fields: { ptsPump: number; ptsNozzle?: number | null; presetType?: string | null; dose?: number | null; price?: number | null },
  requestedById: string | null,
) {
  return prisma.forecourtCommand.create({
    data: {
      tenantId: c.tenantId, companyId: c.companyId, controllerId: c.id, type, ptsPump: fields.ptsPump, ptsNozzle: fields.ptsNozzle ?? null,
      presetType: fields.presetType ?? null, dose: fields.dose ?? null, price: fields.price ?? null, requestPayload: {}, requestedById,
    },
  });
}

export async function authorizePump(tenantId: string, controllerId: string, input: AuthorizeInput, requestedById: string | null) {
  const c = await controllerInTenant(tenantId, controllerId);
  if (input.presetType !== "FullTank" && !(input.dose != null && input.dose > 0)) throw badRequest("حدد المبلغ أو عدد اللترات للتعبئة");
  const command = await createCommand(c, "pump_authorize", { ...input, dose: input.presetType === "FullTank" ? null : input.dose }, requestedById);
  const data: Record<string, unknown> = {
    Pump: input.ptsPump, Type: input.presetType, AutoCloseTransaction: false, CustomData: `athar:${command.id}`,
    ...(input.ptsNozzle ? { Nozzle: input.ptsNozzle } : {}),
    ...(input.presetType !== "FullTank" ? { Dose: input.dose } : {}),
    ...(input.price != null ? { Price: input.price } : {}),
  };
  await prisma.forecourtCommand.update({ where: { id: command.id }, data: { requestPayload: { Type: "PumpAuthorize", Data: data } as Prisma.InputJsonValue } });
  return dispatch(command.id, c.id, "PumpAuthorize", data);
}

export async function stopPump(tenantId: string, controllerId: string, ptsPump: number, emergency: boolean, requestedById: string | null) {
  const c = await controllerInTenant(tenantId, controllerId);
  if (!emergency && ptsPump < 1) throw badRequest("حدد رقم المضخة");
  const type = emergency ? "PumpEmergencyStop" : "PumpStop";
  const command = await createCommand(c, emergency ? "pump_emergency_stop" : "pump_stop", { ptsPump }, requestedById);
  const data = { Pump: ptsPump };
  await prisma.forecourtCommand.update({ where: { id: command.id }, data: { requestPayload: { Type: type, Data: data } } });
  return dispatch(command.id, c.id, type, data);
}

/** آخر أوامر الشركة (أو متحكم واحد منها) — للعرض. */
export async function listCommands(tenantId: string, companyId: string, controllerId?: string) {
  return prisma.forecourtCommand.findMany({
    where: { tenantId, companyId, ...(controllerId ? { controllerId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
