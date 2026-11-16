import { RequestHandler } from "express";
import * as service from "./store.service";
import { STORE_SORTS, StoreSort } from "./store.service";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v: unknown) => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export const getStore: RequestHandler = async (req, res) => {
  const store = await service.resolveStore(req.params.slug);
  res.json({ ...store.info, categories: await service.listCategories(store) });
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
