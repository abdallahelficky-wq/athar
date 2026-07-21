import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";

export const listAccounts: RequestHandler = async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "asc" },
  });
  res.json(accounts);
};

export const createAccount: RequestHandler = async (req, res) => {
  const account = await prisma.account.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(account);
};

export const updateAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الحساب غير موجود");

  const account = await prisma.account.update({ where: { id: existing.id }, data: req.body });
  res.json(account);
};

export const deleteAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الحساب غير موجود");

  await prisma.account.delete({ where: { id: existing.id } });
  res.status(204).send();
};
