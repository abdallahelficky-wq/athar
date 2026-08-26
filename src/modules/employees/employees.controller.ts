import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound, conflict } from "../../lib/httpError";
import { calcEOS, serviceDuration, TerminationReason } from "../../lib/hrCalculations";
import { hashPassword } from "../../lib/password";
import { ensurePartyAccount } from "../../lib/partyAccounts";

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
  const settingsByCompany = new Map<string, any>();
  const result = await Promise.all(employees.map(async (employee) => {
    let settings = settingsByCompany.get(employee.companyId);
    if (!settings) { settings = await prisma.payrollSettings.findUnique({ where: { companyId: employee.companyId } }); settingsByCompany.set(employee.companyId, settings || {}); }
    const today = new Date();
    const serviceDays = Math.max((today.getTime() - employee.hireDate.getTime()) / 86_400_000, 0);
    const firstFiveDays = Math.min(serviceDays, 5 * 365), laterDays = Math.max(serviceDays - 5 * 365, 0);
    const accruedDays = firstFiveDays / 365 * Number(settings?.leaveDaysBeforeFive ?? 21) + laterDays / 365 * Number(settings?.leaveDaysAfterFive ?? 30);
    const used: any = await (prisma.leaveSettlement as any).aggregate({ where: { employeeId: employee.id }, _sum: { leaveDays: true } });
    const usedDays = Number(used._sum.leaveDays ?? 0), remainingDays = Math.max(accruedDays - usedDays, 0);
    const totalSalary = Number(employee.basicSalary) + Number(employee.housingAllowance) + Number(employee.transportAllowance) + Number(employee.otherAllowance);
    const leaveBasis = settings?.leaveSalaryBasis === "basic" ? Number(employee.basicSalary) : settings?.leaveSalaryBasis === "basic_housing" ? Number(employee.basicSalary) + Number(employee.housingAllowance) : totalSalary;
    const eosBase = settings?.eosSalaryBasis === "basic" ? { basicSalary: Number(employee.basicSalary), housingAllowance: 0 } : settings?.eosSalaryBasis === "total" ? { basicSalary: totalSalary, housingAllowance: 0 } : { basicSalary: Number(employee.basicSalary), housingAllowance: Number(employee.housingAllowance) };
    return { ...employee, liveBalances: { asOf: today, leave: { accruedDays, usedDays, remainingDays, amount: remainingDays * leaveBasis / Number(settings?.leaveDailyRateDivisor ?? 30) }, eos: calcEOS({ ...eosBase, hireDate: employee.hireDate }, today, "employer").finalAmount } };
  }));
  res.json(result);
};

export const getEmployee: RequestHandler = async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { documents: true },
  });
  if (!employee) throw notFound("الموظف غير موجود");
  res.json(employee);
};

/** إنشاء موظف جديد مع حساب تفصيلي مستقل تلقائي تحت "ذمم الموظفين" (partyAccounts.ts)، وإسناد
 * بنود الرواتب الافتراضية (appliesByDefault) تلقائياً إن كانت الشركة قد أُعِدَّت لها بنود رواتب بعد. */
export const createEmployee: RequestHandler = async (req, res) => {
  const { documents, ...data } = req.body;
  await assertCompanyBelongsToTenant(req.auth!.tenantId, data.companyId);
  if (data.managerId) await assertManagerBelongsToTenant(req.auth!.tenantId, data.managerId);
  const employee = await prisma.$transaction(async (tx) => {
    const { accountId } = await ensurePartyAccount(tx, {
      tenantId: req.auth!.tenantId, companyId: data.companyId, kind: "employee", partyName: data.name,
    });
    const created = await tx.employee.create({
      data: { ...data, tenantId: req.auth!.tenantId, accountId, documents: { create: documents } },
      include: { documents: true },
    });

    const defaultComponents = await tx.payrollComponent.findMany({
      where: { tenantId: req.auth!.tenantId, companyId: data.companyId, isActive: true, appliesByDefault: true },
      select: { id: true },
    });
    if (defaultComponents.length) {
      await tx.employeePayrollComponent.createMany({
        data: defaultComponents.map((c) => ({ tenantId: req.auth!.tenantId, employeeId: created.id, componentId: c.id, isActive: true })),
      });
    }

    return created;
  });
  res.status(201).json(employee);
};

export const importEmployees: RequestHandler = async (req, res) => {
  const { companyId, rows } = req.body;
  await assertCompanyBelongsToTenant(req.auth!.tenantId, companyId);
  const numbers = rows.map((row: any) => row.employeeNumber?.trim()).filter(Boolean);
  const duplicateInFile = numbers.find((number: string, index: number) => numbers.indexOf(number) !== index);
  if (duplicateInFile) throw conflict(`الرقم الوظيفي ${duplicateInFile} مكرر داخل ملف Excel`);
  const existing: any = numbers.length ? await prisma.employee.findFirst({ where: { companyId, employeeNumber: { in: numbers } } as any }) : null;
  if (existing) throw conflict(`الرقم الوظيفي ${existing.employeeNumber} موجود مسبقاً في هذه الشركة`);

  const created = await prisma.$transaction(async (tx) => {
    const defaultComponents = await tx.payrollComponent.findMany({
      where: { tenantId: req.auth!.tenantId, companyId, isActive: true, appliesByDefault: true }, select: { id: true },
    });
    const result = [];
    for (const row of rows) {
      const { documents = [], ...data } = row;
      const { accountId } = await ensurePartyAccount(tx, {
        tenantId: req.auth!.tenantId, companyId, kind: "employee", partyName: data.name,
      });
      const employee = await tx.employee.create({
        data: { ...data, companyId, tenantId: req.auth!.tenantId, accountId, documents: { create: documents } },
      });
      if (defaultComponents.length) await tx.employeePayrollComponent.createMany({
        data: defaultComponents.map((component) => ({ tenantId: req.auth!.tenantId, employeeId: employee.id, componentId: component.id, isActive: true })),
      });
      result.push(employee);
    }
    return result;
  });
  res.status(201).json({ imported: created.length });
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
    const updated = await tx.employee.update({
      where: { id: existing.id },
      data: { ...data, ...(documents ? { documents: { create: documents } } : {}) },
      include: { documents: true },
    });
    if (updated.accountId && data.name && data.name !== existing.name) {
      await tx.account.update({ where: { id: updated.accountId }, data: { name: data.name } });
    }
    return updated;
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

