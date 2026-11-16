import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchProduct, fetchProducts, fetchStore, imageUrl } from "./api";
import { addToCart, cartTotals, loadCart, refreshRow, removeFromCart, saveCart, setQty, MAX_QTY } from "./cart";
import { STRINGS, buildOrderMessage, formatMoney, localDescription, localName, whatsappOrderLink } from "./strings";

/**
 * واجهة المتجر الإلكتروني العام: /store/<رابط المتجر> — الرئيسية والتصنيف والبحث، صفحة المنتج، والسلة.
 * كل ما يُعرَض يأتي من GET /api/store/* (أصناف الشركة المنشورة فقط). الطلب في هذه المرحلة رسالة واتساب جاهزة.
 */
const LANG_KEY = "athar.store.lang";
const StoreContext = createContext(null);
const useStore = () => useContext(StoreContext);

const base = (slug) => `/store/${encodeURIComponent(slug)}`;
const productPath = (slug, code) => `${base(slug)}/product/${encodeURIComponent(code)}`;

function readLang() {
  try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "ar"; } catch { return "ar"; }
}

function setMeta(title, description) {
  document.title = title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", description || "");
}

function ProductImage({ path, alt, code }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(path);
  if (!src || failed) return <div className="st-img st-img-empty" role="img" aria-label={alt}><span dir="ltr">{code}</span></div>;
  return <img className="st-img" src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function StoreShell() {
  const { slug } = useParams();
  const [lang, setLang] = useState(readLang);
  const [store, setStore] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | notFound | error
  const [cart, setCart] = useState(() => loadCart(slug));
  const t = STRINGS[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* تفضيل غير محفوظ */ }
  }, [lang, t.dir]);

  const load = useCallback(() => {
    setStatus("loading");
    fetchStore(slug, lang)
      .then((s) => { setStore(s); setStatus("ready"); })
      .catch((e) => setStatus(e.status === 404 ? "notFound" : "error"));
    // اللغة لا تغيّر بيانات المتجر (الأسماء باللغتين في الرد نفسه)، فلا يُعاد الجلب عند تبديلها
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  useEffect(load, [load]);
  useEffect(() => { setCart(loadCart(slug)); }, [slug]);

  const updateCart = useCallback((fn) => setCart((prev) => { const next = fn(prev); saveCart(slug, next); return next; }), [slug]);
  const value = useMemo(() => ({ slug, store, lang, t, cart, updateCart, money: (n) => formatMoney(n, store?.currency || "SAR", lang) }), [slug, store, lang, t, cart, updateCart]);

  if (status === "loading") return <div className="st-state">{t.loading}</div>;
  if (status === "notFound") return <div className="st-state"><h1>{t.storeNotFound}</h1><p>{t.storeNotFoundHint}</p></div>;
  if (status === "error") return <div className="st-state"><p>{t.error}</p><button className="st-btn" onClick={load}>{t.retry}</button></div>;

  const count = cartTotals(cart).count;
  return (
    <StoreContext.Provider value={value}>
      <div className="st-app">
        <header className="st-header">
          <div className="st-header-row">
            <Link to={base(slug)} className="st-brand">{localName(store, lang)}</Link>
            <div className="st-header-actions">
              <button type="button" className="st-lang" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t.langToggle}</button>
              <Link to={`${base(slug)}/cart`} className="st-cart-link" aria-label={`${t.cart} (${count})`}>
                {t.cart}{count > 0 && <span className="st-badge">{count}</span>}
              </Link>
            </div>
          </div>
          <SearchBar />
        </header>
        <main className="st-main">
          <Routes>
            <Route index element={<Catalog />} />
            <Route path="category/:category" element={<Catalog />} />
            <Route path="product/:code" element={<ProductPage />} />
            <Route path="cart" element={<CartPage />} />
            <Route path="*" element={<Navigate to={base(slug)} replace />} />
          </Routes>
        </main>
        <footer className="st-footer">
          <strong>{localName(store, lang)}</strong>
          {store.vatNumber && <span>{t.vatNumber}: <bdi dir="ltr">{store.vatNumber}</bdi></span>}
          {store.crNumber && <span>{t.crNumber}: <bdi dir="ltr">{store.crNumber}</bdi></span>}
          <span className="st-powered">{t.poweredBy}</span>
        </footer>
      </div>
    </StoreContext.Provider>
  );
}

function SearchBar() {
  const { slug, t } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  useEffect(() => { setQ(params.get("q") || ""); }, [params]);
  const submit = (e) => {
    e.preventDefault();
    const text = q.trim();
    navigate(text ? `${base(slug)}?q=${encodeURIComponent(text)}` : base(slug));
  };
  return (
    <form className="st-search" role="search" onSubmit={submit}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} maxLength={80} />
      <button type="submit" className="st-btn">{t.searchBtn}</button>
    </form>
  );
}

const PAGE_SIZE = 24;

function Catalog() {
  const { slug, store, lang, t } = useStore();
  const { category } = useParams();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") || "";
  const sort = params.get("sort") || "newest";
  const [state, setState] = useState({ status: "loading", products: [], total: 0, page: 1 });

  const load = useCallback((page) => {
    setState((s) => ({ ...s, status: page === 1 ? "loading" : "more" }));
    fetchProducts(slug, { category, search, sort, page, pageSize: PAGE_SIZE }, lang)
      .then((r) => setState((s) => ({ status: "ready", total: r.total, page, products: page === 1 ? r.products : [...s.products, ...r.products] })))
      .catch(() => setState((s) => ({ ...s, status: "error" })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, category, search, sort]);
  useEffect(() => { load(1); }, [load]);

  const heading = search ? t.resultsFor(search) : category || t.latest;
  useEffect(() => {
    const name = localName(store, lang);
    setMeta(category || search ? `${heading} — ${name}` : name, `${name} — ${store.categories.map((c) => c.name).join("، ")}`);
  }, [store, lang, heading, category, search]);

  const setSort = (value) => {
    const next = new URLSearchParams(params);
    if (value === "newest") next.delete("sort"); else next.set("sort", value);
    setParams(next, { replace: true });
  };

  return (
    <>
      {store.categories.length > 0 && (
        <nav className="st-cats" aria-label={t.categories}>
          <Link to={base(slug)} className={!category && !search ? "active" : ""}>{t.all}</Link>
          {store.categories.map((c) => (
            <Link key={c.name} to={`${base(slug)}/category/${encodeURIComponent(c.name)}`} className={category === c.name ? "active" : ""}>
              {c.name} <small>{c.count}</small>
            </Link>
          ))}
        </nav>
      )}
      <div className="st-list-head">
        <h1>{heading}</h1>
        <div className="st-list-tools">
          {state.status !== "loading" && <span className="st-muted">{t.results(state.total)}</span>}
          <label className="st-sort">{t.sort}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(t.sorts).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {state.status === "loading" && <p className="st-state">{t.loading}</p>}
      {state.status === "error" && <div className="st-state"><p>{t.error}</p><button className="st-btn" onClick={() => load(1)}>{t.retry}</button></div>}
      {state.status !== "loading" && state.status !== "error" && state.products.length === 0 && <p className="st-state">{t.emptyList}</p>}
      <div className="st-grid">
        {state.products.map((p) => <ProductCard key={p.code} product={p} />)}
      </div>
      {state.products.length < state.total && state.status !== "error" && (
        <div className="st-more"><button className="st-btn st-btn-ghost" disabled={state.status === "more"} onClick={() => load(state.page + 1)}>{state.status === "more" ? t.loading : t.more}</button></div>
      )}
    </>
  );
}

function ProductCard({ product }) {
  const { slug, lang, t, money } = useStore();
  const name = localName(product, lang);
  return (
    <Link to={productPath(slug, product.code)} className={`st-card${product.inStock ? "" : " st-card-out"}`}>
      <ProductImage path={product.images[0]} alt={name} code={product.code} />
      <div className="st-card-body">
        <span className="st-card-name">{name}</span>
        <span className="st-card-code" dir="ltr">{product.code}</span>
        <span className="st-card-price">{money(product.price)}</span>
        {!product.inStock && <span className="st-stock st-stock-out">{t.outOfStock}</span>}
      </div>
    </Link>
  );
}

function ProductPage() {
  const { slug, store, lang, t, money, updateCart } = useStore();
  const { code } = useParams();
  const [state, setState] = useState({ status: "loading", product: null });
  const [active, setActive] = useState(0);
  const [qty, setQtyValue] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setState({ status: "loading", product: null });
    setActive(0); setQtyValue(1); setAdded(false);
    fetchProduct(slug, code, lang)
      .then((product) => setState({ status: "ready", product }))
      .catch((e) => setState({ status: e.status === 404 ? "notFound" : "error", product: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, code]);

  const product = state.product;
  const name = product ? localName(product, lang) : "";
  const description = product ? localDescription(product, lang) : "";

  useEffect(() => {
    if (!product) return undefined;
    setMeta(`${name} — ${localName(store, lang)}`, description || name);
    // بيانات منظَّمة للمنتج (schema.org) لمحركات البحث ومعاينات الروابط
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", name, sku: product.code, description: description || undefined,
      image: product.images.map(imageUrl),
      offers: { "@type": "Offer", price: product.price.toFixed(2), priceCurrency: store.currency, availability: `https://schema.org/${product.inStock ? "InStock" : "OutOfStock"}` },
    });
    document.head.appendChild(el);
    return () => el.remove();
  }, [product, name, description, store, lang]);

  if (state.status === "loading") return <p className="st-state">{t.loading}</p>;
  if (state.status !== "ready") return <div className="st-state"><p>{state.status === "notFound" ? t.productNotFound : t.error}</p><Link className="st-btn" to={base(slug)}>{t.back}</Link></div>;

  const add = () => { updateCart((rows) => addToCart(rows, product, qty)); setAdded(true); };
  const changeQty = (n) => setQtyValue(Math.min(MAX_QTY, Math.max(1, Math.floor(Number(n) || 1))));

  return (
    <article className="st-product">
      <div className="st-gallery">
        <ProductImage key={product.images[active] || "none"} path={product.images[active]} alt={name} code={product.code} />
        {product.images.length > 1 && (
          <div className="st-thumbs">
            {product.images.map((img, i) => (
              <button key={img} type="button" className={i === active ? "active" : ""} onClick={() => setActive(i)} aria-label={`${name} ${i + 1}`}>
                <img src={imageUrl(img)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="st-product-info">
        {product.category && <Link className="st-crumb" to={`${base(slug)}/category/${encodeURIComponent(product.category)}`}>{product.category}</Link>}
        <h1>{name}</h1>
        <p className="st-price">{money(product.price)}</p>
        <p className="st-muted">{t.vatIncluded}</p>
        <p className={`st-stock ${product.inStock ? "st-stock-in" : "st-stock-out"}`}>{product.inStock ? t.inStock : t.outOfStock}</p>
        <dl className="st-specs">
          <div><dt>{t.code}</dt><dd dir="ltr">{product.code}</dd></div>
          {product.countryOfOrigin && <div><dt>{t.origin}</dt><dd>{product.countryOfOrigin}</dd></div>}
          {product.unit && <div><dt>{t.unit}</dt><dd>{product.unit}</dd></div>}
        </dl>
        {description && <p className="st-description">{description}</p>}
        <div className="st-buy">
          <label className="st-qty">{t.qty}
            <span>
              <button type="button" onClick={() => changeQty(qty - 1)} aria-label="-">−</button>
              <input type="number" inputMode="numeric" min="1" max={MAX_QTY} value={qty} onChange={(e) => changeQty(e.target.value)} />
              <button type="button" onClick={() => changeQty(qty + 1)} aria-label="+">+</button>
            </span>
          </label>
          <button type="button" className="st-btn st-btn-primary" disabled={!product.inStock} onClick={add}>{t.add}</button>
        </div>
        {added && <p className="st-added" role="status">{t.added} — <Link to={`${base(slug)}/cart`}>{t.viewCart}</Link></p>}
      </div>
    </article>
  );
}

function CartPage() {
  const { slug, store, lang, t, money, cart, updateCart } = useStore();
  const [customer, setCustomer] = useState({ name: "", mobile: "", city: "", notes: "" });
  const [gone, setGone] = useState([]); // أكواد لم تعد معروضة أو غير متوفرة
  const [formError, setFormError] = useState("");

  useEffect(() => { setMeta(`${t.cart} — ${localName(store, lang)}`, ""); }, [t, store, lang]);

  // الأسعار والتوفر من الخادم عند فتح السلة — اللقطة المحفوظة قد تكون قديمة
  useEffect(() => {
    let cancelled = false;
    const codes = cart.map((r) => r.code);
    Promise.all(codes.map((code) => fetchProduct(slug, code, lang).then((p) => ({ code, product: p })).catch((e) => ({ code, missing: e.status === 404 }))))
      .then((results) => {
        if (cancelled) return;
        const fresh = new Map(results.filter((r) => r.product).map((r) => [r.code, r.product]));
        setGone(results.filter((r) => r.missing || (r.product && !r.product.inStock)).map((r) => r.code));
        updateCart((rows) => rows.map((row) => (fresh.has(row.code) ? refreshRow(row, fresh.get(row.code)) : row)));
      });
    return () => { cancelled = true; };
    // مرة عند فتح الصفحة فقط
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const orderable = cart.filter((r) => !gone.includes(r.code));
  const totals = cartTotals(orderable);

  if (cart.length === 0) return <div className="st-state"><p>{t.emptyCart}</p><Link className="st-btn" to={base(slug)}>{t.browse}</Link></div>;

  const submit = (e) => {
    e.preventDefault();
    const clean = { name: customer.name.trim(), mobile: customer.mobile.trim(), city: customer.city.trim(), notes: customer.notes.trim() };
    if (!clean.name || !clean.mobile || !clean.city || orderable.length === 0) { setFormError(t.required); return; }
    setFormError("");
    const message = buildOrderMessage({ storeName: store.name, rows: orderable, totals, currency: store.currency, customer: clean });
    window.open(whatsappOrderLink(store.whatsappNumber, message), "_blank", "noopener");
  };
  const field = (key) => ({ value: customer[key], onChange: (e) => setCustomer({ ...customer, [key]: e.target.value }) });

  return (
    <div className="st-cart">
      <section>
        <h1>{t.cart}</h1>
        <ul className="st-cart-list">
          {cart.map((row) => {
            const name = localName(row, lang);
            const isGone = gone.includes(row.code);
            return (
              <li key={row.code} className={isGone ? "st-cart-gone" : ""}>
                <Link to={productPath(slug, row.code)} className="st-cart-img"><ProductImage path={row.image} alt={name} code={row.code} /></Link>
                <div className="st-cart-info">
                  <Link to={productPath(slug, row.code)}>{name}</Link>
                  <span className="st-card-code" dir="ltr">{row.code}</span>
                  {isGone ? <span className="st-stock st-stock-out">{t.unavailable}</span> : <span className="st-muted">{money(row.price)}</span>}
                </div>
                <div className="st-cart-controls">
                  <span className="st-qty-inline">
                    <button type="button" onClick={() => updateCart((rows) => setQty(rows, row.code, row.qty - 1))} aria-label="-">−</button>
                    <input type="number" inputMode="numeric" min="1" max={MAX_QTY} value={row.qty} aria-label={t.qty} onChange={(e) => updateCart((rows) => setQty(rows, row.code, e.target.value))} />
                    <button type="button" onClick={() => updateCart((rows) => setQty(rows, row.code, row.qty + 1))} aria-label="+">+</button>
                  </span>
                  <strong>{money(row.price * row.qty)}</strong>
                  <button type="button" className="st-link" onClick={() => updateCart((rows) => removeFromCart(rows, row.code))}>{t.remove}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <aside className="st-summary">
        <dl>
          <div><dt>{t.subtotal}</dt><dd>{money(totals.exVat)}</dd></div>
          <div><dt>{t.vat}</dt><dd>{money(totals.vat)}</dd></div>
          <div className="st-total"><dt>{t.total}</dt><dd>{money(totals.total)}</dd></div>
        </dl>
        {store.whatsappNumber ? (
          <form onSubmit={submit} className="st-checkout">
            <h2>{t.yourDetails}</h2>
            <label>{t.name}<input type="text" autoComplete="name" maxLength={80} {...field("name")} /></label>
            <label>{t.mobile}<input type="tel" dir="ltr" autoComplete="tel" maxLength={20} {...field("mobile")} /></label>
            <label>{t.city}<input type="text" autoComplete="address-level2" maxLength={60} {...field("city")} /></label>
            <label>{t.notes}<textarea rows={2} maxLength={300} {...field("notes")} /></label>
            {formError && <p className="st-error" role="alert">{formError}</p>}
            <button type="submit" className="st-btn st-btn-primary st-btn-block" disabled={orderable.length === 0}>{t.complete}</button>
            <p className="st-muted">{t.completeNote}</p>
          </form>
        ) : <p className="st-muted">{t.noWhatsapp}</p>}
      </aside>
    </div>
  );
}

export default function StoreApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/store/:slug/*" element={<StoreShell />} />
        <Route path="*" element={<div className="st-state"><h1>{STRINGS[readLang()].storeNotFound}</h1><p>{STRINGS[readLang()].storeNotFoundHint}</p></div>} />
      </Routes>
    </BrowserRouter>
  );
}
