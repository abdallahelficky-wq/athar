import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import { vatRatePercentOf } from "../../lib/companyVat";
import { getItemTotalOnHand } from "../../lib/costingEngine";
import { suspendedCompanyIds } from "../../lib/subscriptionEnforcement";
import { getPresignedGetUrl } from "../../lib/storage";
import { isQuantityTracked } from "../items/items.service";
import { storePrice } from "./storePricing";

/**
 * المتجر الإلكتروني العام — قراءة فقط وبلا مصادقة. حدود الثقة كلها هنا:
 *  - المتجر يُحدَّد من الرابط (storeSlug) إلى شركة واحدة فعّلته، وكل استعلام بعدها مقيَّد بـtenantId + companyId لتلك الشركة.
 *  - لا يُقرأ من الصنف إلا أعمدة العرض (PUBLIC_ITEM_SELECT): لا تكلفة ولا متوسط تكلفة ولا آخر سعر شراء ولا حسابات.
 *  - الكمية لا تخرج رقماً، فقط متوفر/غير متوفر.
 *  - صنف مؤرشف أو غير منشور أو بلا سعر بيع لا يظهر، ولا صورته.
 */
export const STORE_IMAGE_ENTITY_TYPE = "item_store_image";

const STORE_NOT_FOUND = "المتجر غير موجود";
const PRODUCT_NOT_FOUND = "المنتج غير موجود";

export const PUBLIC_ITEM_SELECT = {
  id: true,
  code: true,
  name: true,
  nameEn: true,
  category: true,
  unit: true,
  type: true,
  salePrice: true,
  priceIncludesVat: true,
  taxCategoryCode: true,
  vatApplicable: true,
  storeDescription: true,
  storeDescriptionEn: true,
  countryOfOrigin: true,
} satisfies Prisma.ItemSelect;

type PublicItemRow = Prisma.ItemGetPayload<{ select: typeof PUBLIC_ITEM_SELECT }>;

export interface StoreContext {
  tenantId: string;
  companyId: string;
  slug: string;
  vatRatePercent: number;
  country: string;
  info: { slug: string; name: string; nameEn: string | null; whatsappNumber: string | null; currency: string; vatNumber: string | null; crNumber: string | null };
}

/** الشركة صاحبة المتجر — أو 404 بالرسالة نفسها لرابط غير موجود ولمتجر مطفأ ولشركة معلّقة الاشتراك (لا يُكشف أيها). */
export async function resolveStore(slug: string): Promise<StoreContext> {
  const company = await prisma.company.findFirst({
    where: { storeSlug: slug.toLowerCase(), storeEnabled: true },
    select: { id: true, tenantId: true, name: true, nameEn: true, storeSlug: true, storeName: true, storeNameEn: true, storeWhatsappNumber: true, currency: true, country: true, vatRate: true, vatNumber: true, crNumber: true },
  });
  if (!company || !company.storeSlug) throw notFound(STORE_NOT_FOUND);
  if ((await suspendedCompanyIds(company.tenantId)).has(company.id)) throw notFound(STORE_NOT_FOUND);
  return {
    tenantId: company.tenantId,
    companyId: company.id,
    slug: company.storeSlug,
    vatRatePercent: vatRatePercentOf(company),
    country: company.country,
    info: {
      slug: company.storeSlug,
      name: company.storeName || company.name,
      nameEn: company.storeNameEn || company.nameEn,
      whatsappNumber: company.storeWhatsappNumber,
      currency: company.currency,
      // الرقم الضريبي والسجل التجاري بيانات إفصاح نظامية للمتجر الإلكتروني، وهي مطبوعة أصلاً على كل فاتورة
      vatNumber: company.vatNumber,
      crNumber: company.crNumber,
    },
  };
}

/** شرط الظهور للعموم — مصدر واحد للقائمة والتفاصيل والتصنيفات والصور. */
export function publishedWhere(store: StoreContext): Prisma.ItemWhereInput {
  return {
    tenantId: store.tenantId,
    companyId: store.companyId,
    publishedInStore: true,
    isArchived: false,
    salePrice: { gt: 0 },
    OR: [{ type: { in: ["inventory", "service", "bundle", "periodic_inventory", "non_stock"] } }, { type: "raw_material", allowDirectSale: true }],
  };
}

async function imageIdsByItem(store: StoreContext, itemIds: string[]) {
  const map = new Map<string, string[]>();
  if (!itemIds.length) return map;
  const rows = await prisma.attachment.findMany({
    where: { tenantId: store.tenantId, entityType: STORE_IMAGE_ENTITY_TYPE, entityId: { in: itemIds }, mimeType: { startsWith: "image/" } },
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
    select: { id: true, entityId: true },
  });
  for (const row of rows) map.set(row.entityId, [...(map.get(row.entityId) ?? []), row.id]);
  return map;
}

async function toPublicProduct(store: StoreContext, item: PublicItemRow, imageIds: string[]) {
  // صنف بلا تتبّع كمية (خدمة، غير مخزني) متوفر دائماً
  const inStock = isQuantityTracked(item.type) ? (await getItemTotalOnHand(prisma, store.tenantId, item.id)) > 0 : true;
  return {
    code: item.code,
    name: item.name,
    nameEn: item.nameEn,
    category: item.category,
    unit: item.unit,
    description: item.storeDescription,
    descriptionEn: item.storeDescriptionEn,
    countryOfOrigin: item.countryOfOrigin,
    ...storePrice(
      { salePrice: Number(item.salePrice), priceIncludesVat: item.priceIncludesVat, taxCategoryCode: item.taxCategoryCode, vatApplicable: item.vatApplicable },
      store.vatRatePercent,
    ),
    inStock,
    images: imageIds.map((id) => `/store/${store.slug}/images/${id}`),
  };
}

export const STORE_SORTS = ["newest", "price_asc", "price_desc", "name"] as const;
export type StoreSort = (typeof STORE_SORTS)[number];
export const MAX_PAGE_SIZE = 48;

const ORDER_BY: Record<StoreSort, Prisma.ItemOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  price_asc: [{ salePrice: "asc" }, { id: "asc" }],
  price_desc: [{ salePrice: "desc" }, { id: "asc" }],
  name: [{ name: "asc" }, { id: "asc" }],
};

export async function listProducts(store: StoreContext, query: { category?: string; search?: string; sort?: StoreSort; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);
  const search = query.search?.trim().slice(0, 80);
  const where: Prisma.ItemWhereInput = {
    AND: [
      publishedWhere(store),
      query.category ? { category: query.category } : {},
      search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { nameEn: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const [total, items] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({ where, select: PUBLIC_ITEM_SELECT, orderBy: ORDER_BY[query.sort ?? "newest"], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const images = await imageIdsByItem(store, items.map((i) => i.id));
  return {
    total,
    page,
    pageSize,
    products: await Promise.all(items.map((item) => toPublicProduct(store, item, images.get(item.id) ?? []))),
  };
}

export async function getProduct(store: StoreContext, code: string) {
  const item = await prisma.item.findFirst({ where: { AND: [publishedWhere(store), { code }] }, select: PUBLIC_ITEM_SELECT });
  if (!item) throw notFound(PRODUCT_NOT_FOUND);
  const images = await imageIdsByItem(store, [item.id]);
  return toPublicProduct(store, item, images.get(item.id) ?? []);
}

export async function listCategories(store: StoreContext) {
  const rows = await prisma.item.groupBy({ by: ["category"], where: publishedWhere(store), _count: { _all: true } });
  return rows
    .filter((r) => r.category && r.category.trim())
    .map((r) => ({ name: r.category as string, count: r._count._all }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** رابط مؤقت لصورة منتج — فقط إن كانت صورة متجر لصنف منشور حالياً في هذا المتجر نفسه. */
export async function getProductImageUrl(store: StoreContext, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, tenantId: store.tenantId, entityType: STORE_IMAGE_ENTITY_TYPE, mimeType: { startsWith: "image/" } },
    select: { fileKey: true, entityId: true },
  });
  if (!attachment) throw notFound(PRODUCT_NOT_FOUND);
  const item = await prisma.item.findFirst({ where: { AND: [publishedWhere(store), { id: attachment.entityId }] }, select: { id: true } });
  if (!item) throw notFound(PRODUCT_NOT_FOUND);
  return getPresignedGetUrl(attachment.fileKey);
}
