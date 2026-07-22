import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listCustomers: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const customers = await prisma.customer.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(customers);
};

/** رصيد ذمم العميل من واقع أسطر القيود المرحّلة فعلياً على حساب "ذمم مدينة" — مطابق لـ customerAccountBalance */
export const getCustomerBalance: RequestHandler = async (req, res) => {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!customer) throw notFound("العميل غير موجود");

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      customerId: customer.id,
      account: { name: "ذمم مدينة" },
      journalEntry: { status: "posted", tenantId: req.auth!.tenantId },
    },
    select: { debit: true, credit: true },
  });
  const balance = lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  res.json({ balance });
};

export const createCustomer: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const customer = await prisma.customer.create({ data: { ...req.body, tenantId: req.auth!.tenantId } });
  res.status(201).json(customer);
};

export const updateCustomer: RequestHandler = async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("العميل غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const customer = await prisma.customer.update({ where: { id: existing.id }, data: req.body });
  res.json(customer);
};

export const deleteCustomer: RequestHandler = async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("العميل غير موجود");
  await prisma.customer.delete({ where: { id: existing.id } });
  res.status(204).send();
};
