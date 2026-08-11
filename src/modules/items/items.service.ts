import { Prisma, PrismaClient, Item } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { getItemTotalOnHand } from "../../lib/costingEngine";
import { validateAccountsForType } from "./items.schemas";

type Tx = Prisma.TransactionClient | PrismaClient;

const STOCK_TRACKED_TYPES = ["inventory", "expense", "raw_material", "bundle"] as const;

export function isStockTracked(type: string) {
  return (STOCK_TRACKED_TYPES as readonly string[]).includes(type);
}

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

/** يمنع تغيير نوع الصنف بعد وجود أي معاملة مرتبطة به (حركة مخزون، سطر فاتورة بيع أو شراء). */
async function assertTypeNotLocked(tenantId: string, itemId: string, currentType: string, nextType?: string) {
  if (!nextType || nextType === currentType) return;
  const [movements, salesLines, purchaseLines] = await Promise.all([
    prisma.stockMovement.count({ where: { tenantId, itemId } }),
    prisma.salesInvoiceLine.count({ where: { itemId } }),
    prisma.purchaseInvoiceLine.count({ where: { itemId } }),
  ]);
  if (movements || salesLines || purchaseLines) {
    throw badRequest("لا يمكن تغيير نوع الصنف بعد وجود معاملات مرتبطة به");
  }
}

async function computeQuantityAndValue(tx: Tx, tenantId: string, item: Item) {
  if (!isStockTracked(item.type)) return { quantity: null, stockValue: null };
  const quantity = await getItemTotalOnHand(tx, tenantId, item.id);
  return { quantity, stockValue: quantity * Number(item.averageCost) };
}

export async function listItemsWithComputed(tenantId: string, filters: { companyId?: string; type?: string; search?: string }) {
  const search = filters.search?.trim();
  const items = await prisma.item.findMany({
    where: {
      tenantId,
      companyId: filters.companyId || undefined,
      type: (filters.type as Item["type"]) || undefined,
      // بحث نقطة البيع/الفوترة السريع — يطابق الاسم أو الكود أو الباركود، بلا حاجة لفهرسة نص كامل
      // بحجم كتالوج منشأة صغيرة/متوسطة معتاد.
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { code: { contains: search, mode: "insensitive" as const } },
              { barcode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(
    items.map(async (item) => ({ ...item, ...(await computeQuantityAndValue(prisma, tenantId, item)) })),
  );
}

/** مطابقة تامة (لا جزئية) لباركود صنف داخل شركة معيّنة — تُستخدَم فور مسح باركود بكاميرا نقطة البيع. */
export async function findItemByBarcode(tenantId: string, companyId: string, barcode: string) {
  const item = await prisma.item.findFirst({ where: { tenantId, companyId, barcode, isArchived: false } });
  if (!item) return null;
  return { ...item, ...(await computeQuantityAndValue(prisma, tenantId, item)) };
}

export async function getItemWithComputed(tenantId: string, id: string) {
  const item = await prisma.item.findFirst({ where: { id, tenantId } });
  if (!item) throw notFound("الصنف غير موجود");
  return { ...item, ...(await computeQuantityAndValue(prisma, tenantId, item)) };
}

export async function createItemWithComponents(
  tenantId: string,
  input: Record<string, unknown> & { companyId: string; type: string; components?: { componentItemId: string; quantityPerUnit: number }[] },
) {
  await assertCompanyBelongsToTenant(tenantId, input.companyId);
  const { components, ...itemData } = input;

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.create({ data: { ...itemData, tenantId } as Prisma.ItemUncheckedCreateInput });
    if (input.type === "bundle" && components?.length) {
      await assertComponentsBelongToCompany(tx, tenantId, input.companyId, components);
      await tx.itemComponent.createMany({
        data: components.map((c) => ({ tenantId, parentItemId: item.id, componentItemId: c.componentItemId, quantityPerUnit: c.quantityPerUnit })),
      });
    }
    return item;
  });
}

export async function updateItemWithValidation(tenantId: string, id: string, patch: Record<string, unknown>) {
  const existing = await prisma.item.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الصنف غير موجود");

  await assertTypeNotLocked(tenantId, id, existing.type, patch.type as string | undefined);

  const merged = {
    type: (patch.type as string) ?? existing.type,
    allowDirectSale: (patch.allowDirectSale as boolean) ?? existing.allowDirectSale,
    stockAccountId: patch.stockAccountId !== undefined ? (patch.stockAccountId as string | null) : existing.stockAccountId,
    cogsAccountId: patch.cogsAccountId !== undefined ? (patch.cogsAccountId as string | null) : existing.cogsAccountId,
    revenueAccountId: patch.revenueAccountId !== undefined ? (patch.revenueAccountId as string | null) : existing.revenueAccountId,
    expenseAccountId: patch.expenseAccountId !== undefined ? (patch.expenseAccountId as string | null) : existing.expenseAccountId,
  } as Parameters<typeof validateAccountsForType>[0];

  const error = validateAccountsForType(merged);
  if (error) throw badRequest(error);

  if (patch.companyId) await assertCompanyBelongsToTenant(tenantId, patch.companyId as string);

  return prisma.item.update({ where: { id: existing.id }, data: patch as Prisma.ItemUncheckedUpdateInput });
}

export async function deleteItem(tenantId: string, id: string) {
  const existing = await prisma.item.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الصنف غير موجود");
  const [movements, salesLines, purchaseLines, bomUsage] = await Promise.all([
    prisma.stockMovement.count({ where: { tenantId, itemId: id } }),
    prisma.salesInvoiceLine.count({ where: { itemId: id } }),
    prisma.purchaseInvoiceLine.count({ where: { itemId: id } }),
    prisma.itemComponent.count({ where: { OR: [{ parentItemId: id }, { componentItemId: id }] } }),
  ]);
  if (movements || salesLines || purchaseLines || bomUsage) {
    throw badRequest("لا يمكن حذف صنف له معاملات أو وصفة تصنيع مرتبطة؛ استخدم الأرشفة بدلاً من ذلك");
  }
  await prisma.item.delete({ where: { id: existing.id } });
}

async function assertComponentsBelongToCompany(tx: Tx, tenantId: string, companyId: string, components: { componentItemId: string }[]) {
  const ids = [...new Set(components.map((c) => c.componentItemId))];
  const found = await tx.item.findMany({ where: { id: { in: ids }, tenantId, companyId } });
  if (found.length !== ids.length) throw badRequest("أحد المكوّنات المختارة غير موجود في نفس الشركة");
}

export async function getItemComponents(tenantId: string, parentItemId: string) {
  const parent = await prisma.item.findFirst({ where: { id: parentItemId, tenantId } });
  if (!parent) throw notFound("الصنف غير موجود");
  return prisma.itemComponent.findMany({ where: { parentItemId }, include: { componentItem: true }, orderBy: { createdAt: "asc" } });
}

export async function setItemComponents(tenantId: string, parentItemId: string, components: { componentItemId: string; quantityPerUnit: number }[]) {
  const parent = await prisma.item.findFirst({ where: { id: parentItemId, tenantId } });
  if (!parent) throw notFound("الصنف غير موجود");
  if (parent.type !== "bundle") throw badRequest("قائمة المكوّنات متاحة فقط لأصناف نوع (منتج مجمّع)");
  if (components.some((c) => c.componentItemId === parentItemId)) throw badRequest("لا يمكن أن يكون الصنف مكوّناً لنفسه");

  return prisma.$transaction(async (tx) => {
    await assertComponentsBelongToCompany(tx, tenantId, parent.companyId, components);
    await tx.itemComponent.deleteMany({ where: { parentItemId } });
    if (components.length) {
      await tx.itemComponent.createMany({
        data: components.map((c) => ({ tenantId, parentItemId, componentItemId: c.componentItemId, quantityPerUnit: c.quantityPerUnit })),
      });
    }
    return tx.itemComponent.findMany({ where: { parentItemId }, include: { componentItem: true } });
  });
}
