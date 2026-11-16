import { RequestHandler } from "express";
import * as service from "./store.service";
import { STORE_SORTS, StoreSort } from "./store.service";
import * as auth from "./storeAuth.service";
import * as orders from "./storeOrders.service";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v: unknown) => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export const listStores: RequestHandler = async (_req, res) => {
  res.json(await service.listDirectory());
};

export const getStore: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  // loginEnabled: هل دخول العملاء برمز الجوال متاح الآن (قالب واتساب مضبوط) — الواجهة تخفي الدخول إن لم يكن
  res.json({ ...store.info, loginEnabled: auth.otpDelivery.enabled(), categories: await service.listCategories(store) });
};

export const listProducts: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  const sort = str(req.query.sort);
  res.json(
    await service.listProducts(store, {
      category: str(req.query.category),
      search: str(req.query.search),
      sort: (STORE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as StoreSort) : undefined,
      page: int(req.query.page),
      pageSize: int(req.query.pageSize),
    }),
  );
};

export const getProduct: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  res.json(await service.getProduct(store, req.params.code));
};

export const getProductImage: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  const url = await service.getProductImageUrl(store, req.params.imageId);
  // الصورة تُحمَّل من أصل واجهة المتجر (أصل مختلف عن الخادم): helmet يضبط same-origin افتراضياً فيُحجَب <img>.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  // الرابط الموقَّع صالح ساعة؛ إعادة التوجيه تُخزَّن أقل من ذلك بكثير حتى لا يُعاد استخدام رابط منتهٍ.
  res.setHeader("Cache-Control", "public, max-age=600");
  res.redirect(302, url);
};

// ── حسابات العملاء والطلبات ──

export const requestOtp: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  res.json(await auth.requestOtp(store, req.body?.phone, req.ip || "unknown"));
};

export const verifyOtp: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  res.json(await auth.verifyOtp(store, req.body?.phone, req.body?.code));
};

export const getMe: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  res.json(auth.publicCustomer(await auth.requireCustomer(store, req.headers.authorization)));
};

export const updateMe: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  const customer = await auth.requireCustomer(store, req.headers.authorization);
  res.json(await auth.updateCustomerProfile(store, customer.id, req.body ?? {}));
};

export const createOrder: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  // الدخول اختياري: طلب الزائر بلا رمز يُسجَّل بلا حساب؛ رمز مُرسَل لكنه غير صالح يُرفَض (لا يُتجاهَل بصمت)
  const customer = await auth.customerFromAuthHeader(store, req.headers.authorization);
  res.status(201).json(await orders.createOrder(store, req.body ?? {}, customer?.id ?? null));
};

export const listMyOrders: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  const customer = await auth.requireCustomer(store, req.headers.authorization);
  res.json(await orders.listCustomerOrders(store, customer.id));
};
