import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { calcEOS, serviceDuration, TerminationReason } from "../../lib/hrCalculations";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listEmployees: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const employees = await prisma.employee.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    include: { documents: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(employees);
};

export const getEmployee: RequestHandler = async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { documents: true },
  });
  if (!employee) throw notFound("الموظف غير موجود");
  res.json(employee);
};

export const createEmployee: RequestHandler = async (req, res) => {
  const { documents, ...data } = req.body;
  await assertCompanyBelongsToTenant(req.auth!.tenantId, data.companyId);
  const employee = await prisma.employee.create({
    data: { ...data, tenantId: req.auth!.tenantId, documents: { create: documents } },
    include: { documents: true },
  });
  res.status(201).json(employee);
};

export const updateEmployee: RequestHandler = async (req, res) => {
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الموظف غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const { documents, ...data } = req.body;
  const employee = await prisma.$transaction(async (tx) => {
    if (documents) {
      await tx.employeeDocument.deleteMany({ where: { employeeId: existing.id } });
    }
    return tx.employee.update({
      where: { id: existing.id },
      data: { ...data, ...(documents ? { documents: { create: documents } } : {}) },
      include: { documents: true },
    });
  });
  res.json(employee);
};

/**
 * حساب مكافأة نهاية الخدمة — تقديري توضيحي فقط (المادتان 84 و85 من نظام العمل السعودي)،
 * لا يُخزَّن ولا يُرحَّل أي قيد؛ يتطلب مراجعة قانونية دقيقة قبل الاعتماد الفعلي.
 */
export const calculateEos: RequestHandler = async (req, res) => {
  const employee = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!employee) throw notFound("الموظف غير موجود");

  const { endDate, reason } = req.query;
  if (typeof endDate !== "string") throw badRequest("endDate مطلوب");
  const validReasons: TerminationReason[] = ["resign", "employer", "contractEnd"];
  const terminationReason = validReasons.includes(reason as TerminationReason) ? (reason as TerminationReason) : "employer";

  const end = new Date(endDate);
  const calc = calcEOS(
    { basicSalary: Number(employee.basicSalary), housingAllowance: Number(employee.housingAllowance), hireDate: employee.hireDate },
    end,
    terminationReason,
  );
  const duration = serviceDuration(employee.hireDate, end);
  res.json({ ...calc, duration });
};

export const deleteEmployee: RequestHandler = async (req, res) => {
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الموظف غير موجود");
  await prisma.employee.delete({ where: { id: existing.id } });
  res.status(204).send();
};
