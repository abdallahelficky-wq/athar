import { RequestHandler } from "express";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

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

export const createHrActionBatch: RequestHandler = async (req, res) => {
  const { employeeIds, month, actionType, value, note } = req.body;
  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds }, tenantId: req.auth!.tenantId } });
  if (employees.length !== employeeIds.length) throw badRequest("أحد الموظفين المختارين غير موجود ضمن مستأجرك");

  const batchId = crypto.randomUUID();
  const actions = await prisma.$transaction(
    employeeIds.map((employeeId: string) =>
      prisma.hrAction.create({
        data: { tenantId: req.auth!.tenantId, employeeId, month, actionType, value, note, batchId },
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
