import { RequestHandler } from "express";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { LEGACY_KEY_TO_ACTION_TYPE, LegacyComponentKey } from "../../lib/legacyPayrollComponents";

export const listHrActions: RequestHandler = async (req, res) => {
  const { companyId, month } = req.query;
  const actions = await prisma.hrAction.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      month: typeof month === "string" ? month : undefined,
      employee: { companyId: typeof companyId === "string" ? companyId : undefined },
    },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(actions);
};

/**
 * componentId إما مُعرِّف PayrollComponent حقيقي (بعد تشغيل backfillPayrollComponents.ts)، أو
 * "legacy:<key>" لشركة لم تُهاجَر بعد — في الحالة الثانية يُخزَّن actionType النصي المطابق بلا
 * componentId حقيقي، فيلتقطه المسار الاحتياطي في payrollRuns.service.ts (resolveEffectiveComponents)
 * تماماً كما كان يعمل قبل هذه الميزة، بلا أي تغيير في السلوك.
 */
export const createHrActionBatch: RequestHandler = async (req, res) => {
  const { employeeIds, month, componentId, value, note } = req.body;
  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds }, tenantId: req.auth!.tenantId } });
  if (employees.length !== employeeIds.length) throw badRequest("أحد الموظفين المختارين غير موجود ضمن مستأجرك");

  let realComponentId: string | null = null;
  let actionType: string;
  if (componentId.startsWith("legacy:")) {
    const key = componentId.slice("legacy:".length) as LegacyComponentKey;
    const legacyActionType = LEGACY_KEY_TO_ACTION_TYPE[key];
    if (!legacyActionType) throw badRequest("هذا البند لا يقبل تسويات شهرية");
    actionType = legacyActionType;
  } else {
    const component = await prisma.payrollComponent.findFirst({ where: { id: componentId, tenantId: req.auth!.tenantId } });
    if (!component) throw badRequest("بند الراتب المحدد غير موجود");
    if (!component.allowsMonthlyAdjustments) throw badRequest("هذا البند لا يقبل تسويات شهرية");
    realComponentId = component.id;
    actionType = component.systemKey || "custom";
  }

  const batchId = crypto.randomUUID();
  const actions = await prisma.$transaction(
    employeeIds.map((employeeId: string) =>
      prisma.hrAction.create({
        data: { tenantId: req.auth!.tenantId, employeeId, month, actionType, componentId: realComponentId, value, note, batchId },
      }),
    ),
  );
  res.status(201).json(actions);
};

export const deleteHrAction: RequestHandler = async (req, res) => {
  const existing = await prisma.hrAction.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الإجراء غير موجود");
  await prisma.hrAction.delete({ where: { id: existing.id } });
  res.status(204).send();
};
