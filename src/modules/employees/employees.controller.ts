import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound, conflict } from "../../lib/httpError";
import { calcEOS, serviceDuration, TerminationReason } from "../../lib/hrCalculations";
import { hashPassword } from "../../lib/password";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

async function assertManagerBelongsToTenant(tenantId: string, managerId: string, selfId?: string) {
  if (managerId === selfId) throw badRequest("لا يمكن أن يكون الموظف مديراً مباشراً لنفسه");
  const manager = await prisma.employee.findFirst({ where: { id: managerId, tenantId } });
  if (!manager) throw badRequest("المدير المباشر المحدد غير موجود ضمن مستأجرك");
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
  if (data.managerId) await assertManagerBelongsToTenant(req.auth!.tenantId, data.managerId);
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
  if (req.body.managerId) await assertManagerBelongsToTenant(req.auth!.tenantId, req.body.managerId, existing.id);

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

/**
 * تفعيل/تحديث دخول الموظف لبوابة الجوال (رقم جوال + رمز PIN منفصل تماماً عن حسابات User
 * الإدارية) — الموارد البشرية فقط من يضبطه، ويُخزَّن الـ PIN مجزّأً (bcrypt) كما كلمات مرور User.
 */
export const setEmployeePortalAccess: RequestHandler = async (req, res) => {
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الموظف غير موجود");

  const other = await prisma.employee.findFirst({
    where: { tenantId: req.auth!.tenantId, phone: req.body.phone, id: { not: existing.id } },
  });
  if (other) throw conflict("رقم الجوال هذا مستخدم بالفعل من موظف آخر في مستأجرك");

  const pinHash = await hashPassword(req.body.pin);
  const employee = await prisma.employee.update({
    where: { id: existing.id },
    data: {
      phone: req.body.phone,
      pinHash,
      portalActive: req.body.portalActive,
      failedPortalLoginAttempts: 0,
      portalLockedUntil: null,
    },
  });
  res.json({ id: employee.id, phone: employee.phone, portalActive: employee.portalActive });
};

export const deleteEmployee: RequestHandler = async (req, res) => {
  const existing = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الموظف غير موجود");
  await prisma.employee.delete({ where: { id: existing.id } });
  res.status(204).send();
};
