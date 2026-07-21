import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";

export const listCompanies: RequestHandler = async (req, res) => {
  const companies = await prisma.company.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "asc" },
  });
  res.json(companies);
};

export const createCompany: RequestHandler = async (req, res) => {
  const company = await prisma.company.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(company);
};

export const updateCompany: RequestHandler = async (req, res) => {
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الشركة غير موجودة");

  const company = await prisma.company.update({ where: { id: existing.id }, data: req.body });
  res.json(company);
};

export const deleteCompany: RequestHandler = async (req, res) => {
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الشركة غير موجودة");

  await prisma.company.delete({ where: { id: existing.id } });
  res.status(204).send();
};
