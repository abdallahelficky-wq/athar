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
export const STORE_BANNER_ENTITY_TYPE = "store_banner";

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
  storeCompareAtPrice: true,
  storeFeatured: true,
  storeVariantGroup: true,
  storeVariantColor: true,
  storeVariantSize: true,
} satisfies Prisma.ItemSelect;

type PublicItemRow = Prisma.ItemGetPayload<{ select: typeof PUBLIC_ITEM_SELECT }>;

/** إعدادات المتجر التي يحتاجها حساب الطلب (الشحن، الدفع، الحد الأدنى) — تُقرأ مع الشركة مرة واحدة لكل طلب. */
export interface StoreSettings {
  freeShippingOver: number | null;
  pickupEnabled: boolean;
  pickupAddress: string | null;
  codEnabled: boolean;
  bankTransferEnabled: boolean;
  bankTransferDetails: string | null;
  minOrderAmount: number | null;
}

export interface StoreContext {
  tenantId: string;
  companyId: string;
  slug: string;
  vatRatePercent: number;
  country: string;
  logoKey: string | null;
  settings: StoreSettings;
  info: {
    slug: string; name: string; nameEn: string | null; whatsappNumber: string | null; currency: string; vatNumber: string | null; crNumber: string | null;
    accentColor: string | null; about: string | null; aboutEn: string | null; social: Record<string, string>; metaPixelId: string | null; hasLogo: boolean;
    policies: { returns: string | null; privacy: string | null };
  };
}

/** الشركة صاحبة المتجر — أو 404 بالرسالة نفسها لرابط غير موجود ولمتجر مطفأ ولشركة معلّقة الاشتراك (لا يُكشف أيها). */
export async function resolveStore(slug: string): Promise<StoreContext> {
  const company = await prisma.company.findFirst({
    where: { storeSlug: slug.toLowerCase(), storeEnabled: true },
    select: {
      id: true, tenantId: true, name: true, nameEn: true, storeSlug: true, storeName: true, storeNameEn: true, storeWhatsappNumber: true,
      currency: true, country: true, vatRate: true, vatNumber: true, crNumber: true, logoKey: true,
      storeAccentColor: true, storeAbout: true, storeAboutEn: true, storeSocial: true, storeMetaPixelId: true,
      storeFreeShippingOver: true, storePickupEnabled: true, storePickupAddress: true,
      storeCodEnabled: true, storeBankTransferEnabled: true, storeBankTransferDetails: true, storeMinOrderAmount: true,
      storeReturnPolicy: true, storePrivacyPolicy: true,
    },
  });
  if (!company || !company.storeSlug) throw notFound(STORE_NOT_FOUND);
  if ((await suspendedCompanyIds(company.tenantId)).has(company.id)) throw notFound(STORE_NOT_FOUND);
  return {
    tenantId: company.tenantId,
    companyId: company.id,
    slug: company.storeSlug,
    vatRatePercent: vatRatePercentOf(company),
    country: company.country,
    logoKey: company.logoKey,
    settings: {
      freeShippingOver: company.storeFreeShippingOver == null ? null : Number(company.storeFreeShippingOver),
      pickupEnabled: company.storePickupEnabled,
      pickupAddress: company.storePickupAddress,
      codEnabled: company.storeCodEnabled,
      bankTransferEnabled: company.storeBankTransferEnabled,
      bankTransferDetails: company.storeBankTransferDetails,
      minOrderAmount: company.storeMinOrderAmount == null ? null : Number(company.storeMinOrderAmount),
    },
    info: {
      slug: company.storeSlug,
      name: company.storeName || company.name,
      nameEn: company.storeNameEn || company.nameEn,
      whatsappNumber: company.storeWhatsappNumber,
      currency: company.currency,
      // الرقم الضريبي والسجل التجاري بيانات إفصاح نظامية للمتجر الإلكتروني، وهي مطبوعة أصلاً على كل فاتورة
      vatNumber: company.vatNumber,
      crNumber: company.crNumber,
      accentColor: company.storeAccentColor,
      about: company.storeAbout,
      aboutEn: company.storeAboutEn,
      social: sanitizeSocial(company.storeSocial),
      metaPixelId: company.storeMetaPixelId,
      hasLogo: Boolean(company.logoKey),
      policies: { returns: company.storeReturnPolicy, privacy: company.storePrivacyPolicy },
    },
  };
}

/**
 * دليل المتاجر العام: المتاجر المفعَّلة التي وافقت شركاتها صراحةً على الإدراج (storeListed) فقط، وبالاسم والرابط
 * لا غير. شركة معلّقة الاشتراك لا تُدرَج (كما لا يُفتَح متجرها).
 */
export async function listDirectory() {
  const companies = await prisma.company.findMany({
    where: { storeEnabled: true, storeListed: true, storeSlug: { not: null } },
    select: { id: true, tenantId: true, name: true, nameEn: true, storeSlug: true, storeName: true, storeNameEn: true },
    orderBy: { storeSlug: "asc" },
    take: 500,
  });
  const suspendedByTenant = new Map<string, Set<string>>();
  const stores: { slug: string; name: string; nameEn: string | null }[] = [];
  for (const c of companies) {
    if (!suspendedByTenant.has(c.tenantId)) suspendedByTenant.set(c.tenantId, await suspendedCompanyIds(c.tenantId));
    if (suspendedByTenant.get(c.tenantId)!.has(c.id)) continue;
    stores.push({ slug: c.storeSlug!, name: c.storeName || c.name, nameEn: c.storeNameEn || c.nameEn });
  }
  return stores;
}

const SOCIAL_KEYS = ["instagram", "x", "tiktok", "snapchat", "website"] as const;
/** روابط التواصل المخزَّنة JSON: لا يخرج للعموم إلا المفاتيح المعروفة وبروابط https (تحسّباً لقيمة قديمة أو مكتوبة يدوياً). */
function sanitizeSocial(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const key of SOCIAL_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string" && /^https:\/\//i.test(v)) out[key] = v;
  }
  return out;
}

/** ما يحتاجه العميل ليكمل الطلب: مدن الشحن ورسومها، الاستلام، طرق الدفع، الحد الأدنى، وبانرات الرئيسية. */
export async function getStorefrontConfig(store: StoreContext) {
  const [zones, banners] = await Promise.all([
    prisma.storeShippingZone.findMany({ where: { tenantId: store.tenantId, companyId: store.companyId, isActive: true }, orderBy: { city: "asc" }, select: { city: true, fee: true } }),
    prisma.attachment.findMany({
      where: { tenantId: store.tenantId, entityType: STORE_BANNER_ENTITY_TYPE, entityId: store.companyId, mimeType: { startsWith: "image/" } },
      orderBy: [{ uploadedAt: "asc" }, { id: "asc" }], take: 8, select: { id: true },
    }),
  ]);
  const s = store.settings;
  return {
    logo: store.logoKey ? `/store/${store.slug}/logo` : null,
    banners: banners.map((b) => `/store/${store.slug}/images/${b.id}`),
    shipping: { zones: zones.map((z) => ({ city: z.city, fee: Number(z.fee) })), freeOver: s.freeShippingOver, pickupEnabled: s.pickupEnabled, pickupAddress: s.pickupEnabled ? s.pickupAddress : null },
    payment: { cod: s.codEnabled, bankTransfer: s.bankTransferEnabled, bankTransferDetails: s.bankTransferEnabled ? s.bankTransferDetails : null },
    minOrderAmount: s.minOrderAmount,
  };
}

export async function getStoreLogoUrl(store: StoreContext) {
  if (!store.logoKey) throw notFound(PRODUCT_NOT_FOUND);
  return getPresignedGetUrl(store.logoKey);
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

/**
 * صور الصنف، وإن لم تكن له صور وهو ضمن مجموعة خيارات: صور أول صنف منشور في المجموعة نفسها له صور —
 * فيكفي رفع صورة الموديل مرة واحدة ليظهر بها كل لون/مقاس لم تُرفَع له صورته.
 */
async function imagesWithGroupFallback(store: StoreContext, items: { id: string; storeVariantGroup: string | null }[]) {
  const images = await imageIdsByItem(store, items.map((i) => i.id));
  const groups = [...new Set(items.filter((i) => i.storeVariantGroup && !images.get(i.id)?.length).map((i) => i.storeVariantGroup as string))];
  if (!groups.length) return images;
  const siblings = await prisma.item.findMany({ where: { AND: [publishedWhere(store), { storeVariantGroup: { in: groups } }] }, select: { id: true, storeVariantGroup: true }, orderBy: [{ code: "asc" }] });
  const siblingImages = await imageIdsByItem(store, siblings.map((s) => s.id));
  const byGroup = new Map<string, string[]>();
  for (const s of siblings) {
    const ids = siblingImages.get(s.id);
    if (ids?.length && !byGroup.has(s.storeVariantGroup as string)) byGroup.set(s.storeVariantGroup as string, ids);
  }
  for (const i of items) {
    if (i.storeVariantGroup && !images.get(i.id)?.length && byGroup.has(i.storeVariantGroup)) images.set(i.id, byGroup.get(i.storeVariantGroup) as string[]);
  }
  return images;
}

async function toPublicProduct(store: StoreContext, item: PublicItemRow, imageIds: string[]) {
  // صنف بلا تتبّع كمية (خدمة، غير مخزني) متوفر دائماً
  const inStock = isQuantityTracked(item.type) ? (await getItemTotalOnHand(prisma, store.tenantId, item.id)) > 0 : true;
  const tax = { priceIncludesVat: item.priceIncludesVat, taxCategoryCode: item.taxCategoryCode, vatApplicable: item.vatApplicable };
  const price = storePrice({ salePrice: Number(item.salePrice), ...tax }, store.vatRatePercent);
  const compareAt = item.storeCompareAtPrice == null ? null : storePrice({ salePrice: Number(item.storeCompareAtPrice), ...tax }, store.vatRatePercent).price;
  return {
    code: item.code,
    name: item.name,
    nameEn: item.nameEn,
    category: item.category,
    unit: item.unit,
    description: item.storeDescription,
    descriptionEn: item.storeDescriptionEn,
    countryOfOrigin: item.countryOfOrigin,
    ...price,
    // السعر قبل الخصم (شامل الضريبة) — فقط إن كان أعلى فعلاً من سعر البيع
    compareAtPrice: compareAt != null && compareAt > price.price ? compareAt : null,
    featured: item.storeFeatured,
    variantGroup: item.storeVariantGroup,
    color: item.storeVariantColor,
    size: item.storeVariantSize,
    inStock,
    images: imageIds.map((id) => `/store/${store.slug}/images/${id}`),
  };
}

export const STORE_SORTS = ["newest", "price_asc", "price_desc", "name"] as const;
export type StoreSort = (typeof STORE_SORTS)[number];
export const MAX_PAGE_SIZE = 48;

const ORDER_BY: Record<StoreSort, Prisma.ItemOrderByWithRelationInput[]> = {
  // الافتراضي: المنتجات المميّزة أولاً ثم الأحدث
  newest: [{ storeFeatured: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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
  // مجموعة الخيارات (ألوان/مقاسات) بطاقة واحدة في القائمة: يمثّلها أول صنف منها بحسب الترتيب المطلوب.
  // الترقيم يُحسَب على المنتجات بعد التجميع، فتُقرأ المعرّفات كلها أولاً (حقلان فقط) ثم تُجلَب تفاصيل الصفحة.
  const orderBy = ORDER_BY[query.sort ?? "newest"];
  const all = await prisma.item.findMany({ where, select: { id: true, storeVariantGroup: true }, orderBy, take: LIST_MAX_ITEMS });
  const firstOfGroup = new Map<string, string>();
  const variantCount = new Map<string, number>();
  const cards: string[] = [];
  for (const row of all) {
    const group = row.storeVariantGroup;
    if (!group) { cards.push(row.id); continue; }
    variantCount.set(group, (variantCount.get(group) ?? 0) + 1);
    if (!firstOfGroup.has(group)) { firstOfGroup.set(group, row.id); cards.push(row.id); }
  }
  const pageIds = cards.slice((page - 1) * pageSize, page * pageSize);
  const rows = await prisma.item.findMany({ where: { AND: [publishedWhere(store), { id: { in: pageIds } }] }, select: PUBLIC_ITEM_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = pageIds.map((id) => byId.get(id)).filter((r): r is PublicItemRow => Boolean(r));
  const images = await imagesWithGroupFallback(store, items);
  return {
    total: cards.length,
    page,
    pageSize,
    products: await Promise.all(items.map(async (item) => ({
      ...(await toPublicProduct(store, item, images.get(item.id) ?? [])),
      // عدد الخيارات المطابقة للبحث/التصنيف داخل المجموعة (1 لمنتج بلا خيارات)
      variantCount: item.storeVariantGroup ? variantCount.get(item.storeVariantGroup) ?? 1 : 1,
    }))),
  };
}

export const LIST_MAX_ITEMS = 10000;
export const MAX_VARIANTS = 80;
export const FEED_MAX_PRODUCTS = 5000;
const csvCell = (v: string) => `"${v.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;

/**
 * خلاصة المنتجات (CSV) لكتالوج Meta — فيسبوك وإنستغرام يقرآنها دورياً لبناء إعلانات الكتالوج. تحمل ما يراه أي زائر
 * للمتجر فقط (الأصناف المنشورة، بأسعارها شاملة الضريبة)، ولا يدخلها صنف بلا صورة لأن Meta ترفضه.
 * عند وجود سعر قبل الخصم: price = السعر قبل الخصم، وsale_price = سعر البيع — فيظهر السعر مشطوباً في الإعلان.
 */
export async function buildProductFeed(store: StoreContext, urls: { site: string; api: string }) {
  const items = await prisma.item.findMany({ where: publishedWhere(store), select: PUBLIC_ITEM_SELECT, orderBy: [{ code: "asc" }], take: FEED_MAX_PRODUCTS });
  const images = await imagesWithGroupFallback(store, items);
  const money = (n: number) => `${n.toFixed(2)} ${store.info.currency}`;
  const rows = [["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "brand", "item_group_id", "color", "size"].join(",")];
  for (const item of items) {
    const imageIds = images.get(item.id) ?? [];
    if (imageIds.length === 0) continue;
    const p = await toPublicProduct(store, item, imageIds);
    rows.push([
      p.code, p.name, p.description || p.name, p.inStock ? "in stock" : "out of stock", "new",
      money(p.compareAtPrice ?? p.price), p.compareAtPrice ? money(p.price) : "",
      `${urls.site}/store/${store.slug}/product/${encodeURIComponent(p.code)}`, `${urls.api}${p.images[0]}`, store.info.name,
      // item_group_id يجمع ألوان/مقاسات المنتج الواحد في كتالوج Meta
      p.variantGroup ?? "", p.color ?? "", p.size ?? "",
    ].map(csvCell).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

export async function getProduct(store: StoreContext, code: string) {
  const item = await prisma.item.findFirst({ where: { AND: [publishedWhere(store), { code }] }, select: PUBLIC_ITEM_SELECT });
  if (!item) throw notFound(PRODUCT_NOT_FOUND);
  // خيارات المنتج: كل الأصناف المنشورة في مجموعته (ومنها هو) — لكلٍّ كوده وسعره وتوفره، والعميل يتنقّل بينها
  const siblings = item.storeVariantGroup
    ? await prisma.item.findMany({ where: { AND: [publishedWhere(store), { storeVariantGroup: item.storeVariantGroup }] }, select: PUBLIC_ITEM_SELECT, orderBy: [{ code: "asc" }], take: MAX_VARIANTS })
    : [];
  const images = await imagesWithGroupFallback(store, siblings.length ? siblings : [item]);
  const product = await toPublicProduct(store, item, images.get(item.id) ?? []);
  const variants = await Promise.all(siblings.map(async (s) => {
    const v = await toPublicProduct(store, s, images.get(s.id) ?? []);
    return { code: v.code, color: v.color, size: v.size, price: v.price, compareAtPrice: v.compareAtPrice, inStock: v.inStock, image: v.images[0] ?? null };
  }));
  return { ...product, variants: variants.length > 1 ? variants : [] };
}

export async function listCategories(store: StoreContext) {
  // العدد بالمنتجات كما تظهر في القائمة: مجموعة الخيارات منتج واحد
  const rows = await prisma.item.groupBy({ by: ["category", "storeVariantGroup"], where: publishedWhere(store), _count: { _all: true } });
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.category || !r.category.trim()) continue;
    counts.set(r.category, (counts.get(r.category) ?? 0) + (r.storeVariantGroup ? 1 : r._count._all));
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** رابط مؤقت لصورة منتج — فقط إن كانت صورة متجر لصنف منشور حالياً في هذا المتجر نفسه. */
export async function getProductImageUrl(store: StoreContext, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, tenantId: store.tenantId, entityType: { in: [STORE_IMAGE_ENTITY_TYPE, STORE_BANNER_ENTITY_TYPE] }, mimeType: { startsWith: "image/" } },
    select: { fileKey: true, entityId: true, entityType: true },
  });
  if (!attachment) throw notFound(PRODUCT_NOT_FOUND);
  // بانر: يخص شركة هذا المتجر نفسها (entityId = الشركة)
  if (attachment.entityType === STORE_BANNER_ENTITY_TYPE) {
    if (attachment.entityId !== store.companyId) throw notFound(PRODUCT_NOT_FOUND);
    return getPresignedGetUrl(attachment.fileKey);
  }
  const item = await prisma.item.findFirst({ where: { AND: [publishedWhere(store), { id: attachment.entityId }] }, select: { id: true } });
  if (!item) throw notFound(PRODUCT_NOT_FOUND);
  return getPresignedGetUrl(attachment.fileKey);
}
