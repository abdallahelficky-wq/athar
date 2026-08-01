import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { getAccountIdByName, getGroupAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import crypto from "node:crypto";

const INBOUND_TYPES = ["in", "transfer_in"] as const;
const OUTBOUND_TYPES = ["out", "issue", "transfer_out"] as const;

export async function listStockMovements(tenantId: string, filters: { companyId?: string; itemId?: string }) {
  return prisma.stockMovement.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, itemId: filters.itemId || undefined },
    include: { item: true, warehouse: true },
    orderBy: { date: "desc" },
  });
}

/** رصيد صنف في موقع معيّن = مجموع (إدخال + وارد تحويل) - مجموع (إخراج + صرف + صادر تحويل) */
export async function getStockBalance(tenantId: string, itemId: string, warehouseId: string) {
  const movements = await prisma.stockMovement.findMany({
    where: { tenantId, itemId, warehouseId },
    select: { type: true, quantity: true },
  });
  return movements.reduce((s, m) => {
    const qty = Number(m.quantity);
    if ((INBOUND_TYPES as readonly string[]).includes(m.type)) return s + qty;
    if ((OUTBOUND_TYPES as readonly string[]).includes(m.type)) return s - qty;
    return s;
  }, 0);
}

async function assertItemAndWarehouse(tenantId: string, itemId: string, warehouseId: string) {
  const item = await prisma.item.findFirst({ where: { id: itemId, tenantId } });
  if (!item) throw badRequest("الصنف غير موجود");
  const warehouse = await prisma.costCenter.findFirst({ where: { id: warehouseId, tenantId } });
  if (!warehouse) throw badRequest("الموقع/المخزن غير موجود");
  return { item, warehouse };
}

export async function createInOutMovement(
  tenantId: string,
  userId: string,
  input: { type: "in" | "out"; itemId: string; warehouseId: string; quantity: number; date: Date; note?: string },
) {
  const { item } = await assertItemAndWarehouse(tenantId, input.itemId, input.warehouseId);
  const amount = input.quantity * Number(item.costPrice);

  const [stockId, otherId] =
    input.type === "in"
      ? await Promise.all([getAccountIdByName(tenantId, item.companyId, "المخزون"), getAccountIdByName(tenantId, item.companyId, "تسويات المخزون")])
      : await Promise.all([getAccountIdByName(tenantId, item.companyId, "مصروف تالف ونقص المخزون"), getAccountIdByName(tenantId, item.companyId, "المخزون")]);

  const journalLines =
    input.type === "in"
      ? [
          { accountId: stockId, costCenterId: input.warehouseId, department: "المشتريات", debit: amount, credit: 0 },
          { accountId: otherId, costCenterId: input.warehouseId, department: "المالية والحسابات", debit: 0, credit: amount },
        ]
      : [
          { accountId: stockId, costCenterId: input.warehouseId, department: "المالية والحسابات", debit: amount, credit: 0 },
          { accountId: otherId, costCenterId: input.warehouseId, department: "المشتريات", debit: 0, credit: amount },
        ];

  const memo = `${input.type === "in" ? "إضافة مخزون" : "حذف / إتلاف مخزون"} — ${item.name}`;

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId, companyId: item.companyId, date: input.date, memo, sourceModule: "stock_movement", createdBy: userId, lines: journalLines,
    });
    const movement = await tx.stockMovement.create({
      data: {
        tenantId, companyId: item.companyId, itemId: item.id, warehouseId: input.warehouseId, type: input.type,
        quantity: input.quantity, unitCost: item.costPrice, date: input.date, note: input.note, journalEntryId: entry.id,
      },
      include: { item: true, warehouse: true },
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: movement.id } });
    return movement;
  });
}

export async function createIssueMovement(
  tenantId: string,
  userId: string,
  input: { itemId: string; warehouseId: string; department: string; quantity: number; date: Date; note?: string },
) {
  const { item } = await assertItemAndWarehouse(tenantId, input.itemId, input.warehouseId);
  const balance = await getStockBalance(tenantId, input.itemId, input.warehouseId);
  if (input.quantity > balance) throw badRequest(`الكمية المطلوبة (${input.quantity}) أكبر من الرصيد المتاح (${balance})`);

  const amount = input.quantity * Number(item.costPrice);
  const cogsId = await getAccountIdByName(tenantId, item.companyId, "تكلفة البضاعة المباعة / الصرف المخزني");
  const stockId = await getAccountIdByName(tenantId, item.companyId, "المخزون");

  const journalLines = [
    { accountId: cogsId, costCenterId: input.warehouseId, department: input.department, debit: amount, credit: 0 },
    { accountId: stockId, costCenterId: input.warehouseId, department: "المشتريات", debit: 0, credit: amount },
  ];

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId, companyId: item.companyId, date: input.date,
      memo: `صرف مخزني — ${item.name} (${input.department})`,
      sourceModule: "stock_movement", createdBy: userId, lines: journalLines,
    });
    const movement = await tx.stockMovement.create({
      data: {
        tenantId, companyId: item.companyId, itemId: item.id, warehouseId: input.warehouseId, type: "issue",
        quantity: input.quantity, unitCost: item.costPrice, date: input.date,
        note: `${input.department} — ${input.note || ""}`, journalEntryId: entry.id,
      },
      include: { item: true, warehouse: true },
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: movement.id } });
    return movement;
  });
}

export async function createTransferMovement(
  tenantId: string,
  userId: string,
  input: { itemId: string; fromWarehouseId: string; toWarehouseId: string; toCompanyId: string; quantity: number; date: Date },
) {
  const { item } = await assertItemAndWarehouse(tenantId, input.itemId, input.fromWarehouseId);
  const toWarehouse = await prisma.costCenter.findFirst({ where: { id: input.toWarehouseId, tenantId } });
  if (!toWarehouse) throw badRequest("موقع الوجهة غير موجود");
  const toCompany = await prisma.company.findFirst({ where: { id: input.toCompanyId, tenantId } });
  if (!toCompany) throw badRequest("الشركة المستقبلة غير موجودة");

  const balance = await getStockBalance(tenantId, input.itemId, input.fromWarehouseId);
  if (input.quantity > balance) throw badRequest(`الكمية المطلوبة (${input.quantity}) أكبر من الرصيد المتاح بالمصدر (${balance})`);

  const amount = input.quantity * Number(item.costPrice);
  const stockId = await getAccountIdByName(tenantId, item.companyId, "المخزون");
  const crossCompany = input.toCompanyId !== item.companyId;
  const stockDestId = crossCompany ? await getAccountIdByName(tenantId, input.toCompanyId, "المخزون") : stockId;
  const transferGroupId = crypto.randomUUID();

  return prisma.$transaction(async (tx) => {
    let entrySourceId: string;
    let entryDestId: string | null = null;

    if (!crossCompany) {
      const entry = await createJournalEntryTx(tx, {
        tenantId, companyId: item.companyId, date: input.date,
        memo: `تحويل مخزني داخلي — ${item.name}`,
        sourceModule: "stock_movement", createdBy: userId,
        lines: [
          { accountId: stockId, costCenterId: input.toWarehouseId, department: "المشتريات", debit: amount, credit: 0 },
          { accountId: stockId, costCenterId: input.fromWarehouseId, department: "المشتريات", debit: 0, credit: amount },
        ],
      });
      entrySourceId = entry.id;
    } else {
      const interCompanyId = await getGroupAccountIdByName(tenantId, "حساب جاري - شركات المجموعة");
      const entrySource = await createJournalEntryTx(tx, {
        tenantId, companyId: item.companyId, date: input.date,
        memo: `تحويل مخزون صادر لشركة أخرى — ${item.name}`,
        sourceModule: "stock_movement", createdBy: userId,
        lines: [
          { accountId: interCompanyId, costCenterId: input.fromWarehouseId, department: "المالية والحسابات", debit: amount, credit: 0 },
          { accountId: stockId, costCenterId: input.fromWarehouseId, department: "المشتريات", debit: 0, credit: amount },
        ],
      });
      const entryDest = await createJournalEntryTx(tx, {
        tenantId, companyId: input.toCompanyId, date: input.date,
        memo: `تحويل مخزون وارد من شركة أخرى — ${item.name}`,
        sourceModule: "stock_movement", createdBy: userId,
        lines: [
          { accountId: stockDestId, costCenterId: input.toWarehouseId, department: "المشتريات", debit: amount, credit: 0 },
          { accountId: interCompanyId, costCenterId: input.toWarehouseId, department: "المالية والحسابات", debit: 0, credit: amount },
        ],
      });
      entrySourceId = entrySource.id;
      entryDestId = entryDest.id;
    }

    const outMovement = await tx.stockMovement.create({
      data: {
        tenantId, companyId: item.companyId, itemId: item.id, warehouseId: input.fromWarehouseId, type: "transfer_out",
        quantity: input.quantity, unitCost: item.costPrice, date: input.date,
        note: crossCompany ? `تحويل لشركة ${toCompany.name}` : "تحويل داخلي",
        journalEntryId: entrySourceId, transferGroupId,
      },
    });
    const inMovement = await tx.stockMovement.create({
      data: {
        tenantId, companyId: input.toCompanyId, itemId: item.id, warehouseId: input.toWarehouseId, type: "transfer_in",
        quantity: input.quantity, unitCost: item.costPrice, date: input.date, note: "وارد بالتحويل",
        journalEntryId: entryDestId ?? entrySourceId, transferGroupId,
      },
    });

    await tx.journalEntry.update({ where: { id: entrySourceId }, data: { sourceId: outMovement.id } });
    if (entryDestId) await tx.journalEntry.update({ where: { id: entryDestId }, data: { sourceId: inMovement.id } });

    return { outMovement, inMovement };
  });
}

/** حذف حركة مخزنية (وما يقابلها في حالة التحويل بين شركتين) — محمي برقم سري وفق القسم 4.9 */
export async function removeStockMovement(tenantId: string, userId: string, id: string, pin: string) {
  const movement = await prisma.stockMovement.findFirst({ where: { id, tenantId } });
  if (!movement) throw notFound("الحركة غير موجودة");

  await assertValidUnlockPin(tenantId, pin);

  const group = movement.transferGroupId
    ? await prisma.stockMovement.findMany({ where: { tenantId, transferGroupId: movement.transferGroupId } })
    : [movement];

  const journalEntryIds = [...new Set(group.map((m) => m.journalEntryId).filter((x): x is string => Boolean(x)))];

  await prisma.$transaction(async (tx) => {
    for (const jId of journalEntryIds) await deleteJournalEntryTx(tx, jId);
    await tx.stockMovement.deleteMany({ where: { id: { in: group.map((m) => m.id) } } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "StockMovement", entityId: id, metadata: { relatedIds: group.map((m) => m.id) } });
  });
}
