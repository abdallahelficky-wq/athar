import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createOrder, quoteOrder, fetchDirectory, fetchMe, fetchMyOrders, fetchProduct, fetchProducts, fetchStore, imageUrl, requestOtp, updateMe, verifyOtp } from "./api";
import { addToCart, cartTotals, loadCart, refreshRow, removeFromCart, saveCart, setQty, MAX_QTY } from "./cart";
import { STRINGS, buildOrderMessage, formatMoney, localDescription, localName, whatsappOrderLink } from "./strings";

/**
 * واجهة المتجر الإلكتروني العام: /store/<رابط المتجر> — الرئيسية والتصنيف والبحث، صفحة المنتج، والسلة.
 * كل ما يُعرَض يأتي من GET /api/store/* (أصناف الشركة المنشورة فقط). الطلب في هذه المرحلة رسالة واتساب جاهزة.
 */
const LANG_KEY = "athar.store.lang";
// رمز دخول عميل المتجر — لكل متجر مفتاحه (الحساب خاص بمتجر شركة واحدة)
const sessionKey = (slug) => `athar.store.session.${slug}`;
function readSession(slug) {
  try { return localStorage.getItem(sessionKey(slug)) || null; } catch { return null; }
}
function writeSession(slug, token) {
  try { if (token) localStorage.setItem(sessionKey(slug), token); else localStorage.removeItem(sessionKey(slug)); } catch { /* يبقى في الذاكرة */ }
}
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

/** لون نص مقروء فوق لون المتجر: أسود على الفاتح وأبيض على الداكن (سطوع نسبي WCAG). */
function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}
const accentStyle = (color) => (/^#[0-9a-f]{6}$/i.test(color || "") ? { "--st-accent": color, "--st-accent-ink": inkOn(color) } : undefined);
const SOCIAL_LABELS = { instagram: "Instagram", x: "X", tiktok: "TikTok", snapchat: "Snapchat" };

/**
 * Meta Pixel — يُحمَّل فقط في متجر كتب صاحبه معرّف البكسل في إعداداته، ليقيس إعلانات فيسبوك وإنستغرام
 * (مشاهدة منتج، إضافة للسلة، طلب). بلا معرّف لا يُحمَّل أي سكربت خارجي.
 */
function initPixel(id) {
  if (!/^\d{5,20}$/.test(id || "") || window.fbq) return;
  const fbq = function () { if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments); else fbq.queue.push(arguments); };
  fbq.push = fbq; fbq.loaded = true; fbq.version = "2.0"; fbq.queue = [];
  window.fbq = fbq; window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true; script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  fbq("init", id);
}
const track = (event, data) => { try { window.fbq?.("track", event, data); } catch { /* القياس لا يعطّل المتجر */ } };

/**
 * بيانات التحويل البنكي كما كتبها صاحب المتجر، ومعها — إن احتوى النص على آيبان — رمز QR للآيبان وزر نسخه.
 * الرمز يُولَّد في متصفح العميل من النص نفسه ويحمل الآيبان فقط (نص عادي تقرؤه كاميرا أي جوال) — ليس رمز دفع.
 */
function BankDetails({ text }) {
  const { t } = useStore();
  const iban = (text.replace(/[\s\u200e\u200f]/g, "").toUpperCase().match(/[A-Z]{2}\d{2}[A-Z0-9]{11,30}/) || [])[0] || null;
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setQr(null);
    if (iban) import("qrcode").then((m) => m.toDataURL(iban, { margin: 1, width: 220 })).then((url) => { if (!cancelled) setQr(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [iban]);
  const copy = () => navigator.clipboard?.writeText(iban).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  return (
    <div className="st-bank">
      <strong>{t.bankDetails}</strong>
      <p>{text}</p>
      {iban && (
        <div className="st-bank-iban">
          {qr && <img src={qr} alt={t.ibanQr} width="110" height="110" />}
          <div>
            <span className="st-muted">{t.ibanQr}</span>
            <bdi dir="ltr" className="st-bank-number">{iban}</bdi>
            <button type="button" className="st-btn st-btn-ghost" onClick={copy}>{copied ? t.copied : t.copyIban}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** السعر، ومعه السعر قبل الخصم مشطوباً ونسبة الخصم إن وُجد. */
function Price({ product, className }) {
  const { t, money } = useStore();
  if (!product.compareAtPrice) return <span className={className}>{money(product.price)}</span>;
  const off = Math.round((1 - product.price / product.compareAtPrice) * 100);
  return (
    <span className={`${className} st-price-sale`}>
      <span>{money(product.price)}</span>
      <s className="st-price-was">{money(product.compareAtPrice)}</s>
      {off > 0 && <span className="st-off">{t.off(off)}</span>}
    </span>
  );
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
  const [token, setToken] = useState(() => readSession(slug));
  const [customer, setCustomer] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = STRINGS[lang];

  const signIn = useCallback((newToken, newCustomer) => { writeSession(slug, newToken); setToken(newToken); setCustomer(newCustomer); }, [slug]);
  const signOut = useCallback(() => { writeSession(slug, null); setToken(null); setCustomer(null); }, [slug]);
  // رمز محفوظ من زيارة سابقة: تُجلَب بيانات الحساب، ورمز لم يعد صالحاً يُمسَح بصمت
  useEffect(() => {
    if (!token || customer) return;
    let cancelled = false;
    fetchMe(slug, token, lang).then((c) => { if (!cancelled) setCustomer(c); }).catch((e) => { if (!cancelled && e.status === 401) signOut(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token]);

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

  // البكسل: تحميل مرة عند معرفة المتجر، ثم مشاهدة صفحة مع كل تنقّل
  const location = useLocation();
  const pixelId = store?.metaPixelId || null;
  useEffect(() => { if (pixelId) initPixel(pixelId); }, [pixelId]);
  useEffect(() => { if (pixelId) track("PageView"); }, [pixelId, location.pathname]);

  const updateCart = useCallback((fn) => setCart((prev) => { const next = fn(prev); saveCart(slug, next); return next; }), [slug]);
  const value = useMemo(
    () => ({ slug, store, lang, t, cart, updateCart, token, customer, setCustomer, signIn, signOut, menuOpen, setMenuOpen, money: (n) => formatMoney(n, store?.currency || "SAR", lang) }),
    [slug, store, lang, t, cart, updateCart, token, customer, signIn, signOut, menuOpen],
  );

  if (status === "loading") return <div className="st-state">{t.loading}</div>;
  if (status === "notFound") return <div className="st-state"><h1>{t.storeNotFound}</h1><p>{t.storeNotFoundHint}</p></div>;
  if (status === "error") return <div className="st-state"><p>{t.error}</p><button className="st-btn" onClick={load}>{t.retry}</button></div>;

  const count = cartTotals(cart).count;
  return (
    <StoreContext.Provider value={value}>
      <div className="st-app" style={accentStyle(store.accentColor)}>
        <header className="st-header">
          <div className="st-header-row">
            <div className="st-brand-wrap">
              {store.categories.length > 0 && <button type="button" className="st-menu-btn" aria-label={t.menu} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button>}
              <Link to={base(slug)} className={`st-brand${store.logo ? " st-brand-logo" : ""}`}>
                {store.logo && <img src={imageUrl(store.logo)} alt="" />}
                <span>{localName(store, lang)}</span>
              </Link>
            </div>
            <div className="st-header-actions">
              {store.loginEnabled && <Link to={`${base(slug)}/${token ? "account" : "login"}`} className="st-lang">{token ? t.account : t.signIn}</Link>}
              <button type="button" className="st-lang" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t.langToggle}</button>
              <Link to={`${base(slug)}/cart`} className="st-cart-link" aria-label={`${t.cart} (${count})`}>
                {t.cart}{count > 0 && <span className="st-badge">{count}</span>}
              </Link>
            </div>
          </div>
          <SearchBar />
        </header>
        <CategoryDrawer />
        <main className="st-main">
          <Routes>
            <Route index element={<Catalog />} />
            <Route path="category/:category" element={<Catalog />} />
            <Route path="product/:code" element={<ProductPage />} />
            <Route path="cart" element={<CartPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="policy/:kind" element={<PolicyPage />} />
            <Route path="*" element={<Navigate to={base(slug)} replace />} />
          </Routes>
        </main>
        <footer className="st-footer">
          {(lang === "en" ? store.aboutEn || store.about : store.about) && <p className="st-footer-about">{lang === "en" ? store.aboutEn || store.about : store.about}</p>}
          {Object.keys(store.social || {}).length > 0 && (
            <nav className="st-footer-row" aria-label="social">
              {Object.entries(store.social).map(([k, url]) => <a key={k} className="st-footer-link" href={url} target="_blank" rel="noopener noreferrer">{SOCIAL_LABELS[k] || t.website}</a>)}
            </nav>
          )}
          {(store.policies?.returns || store.policies?.privacy) && (
            <nav className="st-footer-row">
              {store.policies.returns && <Link className="st-footer-link" to={`${base(slug)}/policy/returns`}>{t.returnsPolicy}</Link>}
              {store.policies.privacy && <Link className="st-footer-link" to={`${base(slug)}/policy/privacy`}>{t.privacyPolicy}</Link>}
            </nav>
          )}
          <strong>{localName(store, lang)}</strong>
          {store.vatNumber && <span>{t.vatNumber}: <bdi dir="ltr">{store.vatNumber}</bdi></span>}
          {store.crNumber && <span>{t.crNumber}: <bdi dir="ltr">{store.crNumber}</bdi></span>}
          <Link to="/store" className="st-powered st-footer-link">{t.allStores}</Link>
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
  const { slug, store, lang, t, money } = useStore();
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
  const showBanners = !category && !search && (store.banners || []).length > 0;
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
    <div className={`st-catalog${store.categories.length > 0 ? " st-catalog-with-side" : ""}`}>
      {store.categories.length > 0 && (
        <aside className="st-side" aria-label={t.categories}>
          <h2>{t.categories}</h2>
          <CategoryLinks />
        </aside>
      )}
      <div className="st-catalog-main">
        {showBanners && (
          <div className="st-banners">
            {store.banners.map((b) => <img key={b} src={imageUrl(b)} alt={localName(store, lang)} loading="lazy" />)}
          </div>
        )}
        {!category && !search && store.shipping?.freeOver != null && <p className="st-ribbon">{t.freeShippingHint(money(store.shipping.freeOver))}</p>}
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
      </div>
    </div>
  );
}

/** روابط التصنيفات — تُستخدَم في القائمة الجانبية (الشاشات العريضة) وفي القائمة المنزلقة (الجوال). */
function CategoryLinks({ onNavigate }) {
  const { slug, store, t } = useStore();
  const { category } = useParams();
  const [params] = useSearchParams();
  const allActive = !category && !params.get("q");
  return (
    <ul className="st-side-list">
      <li><Link to={base(slug)} className={allActive ? "active" : ""} onClick={onNavigate}>{t.all}</Link></li>
      {store.categories.map((c) => (
        <li key={c.name}>
          <Link to={`${base(slug)}/category/${encodeURIComponent(c.name)}`} className={category === c.name ? "active" : ""} onClick={onNavigate}>
            <span>{c.name}</span><small>{c.count}</small>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** القائمة الجانبية المنزلقة — تُفتَح من زر ☰ في الهيدر على أي صفحة. */
function CategoryDrawer() {
  const { store, t, menuOpen, setMenuOpen } = useStore();
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, setMenuOpen]);
  if (!menuOpen || store.categories.length === 0) return null;
  return (
    <div className="st-drawer-overlay" onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
      <nav className="st-drawer" role="dialog" aria-modal="true" aria-label={t.menu}>
        <div className="st-drawer-head"><strong>{t.menu}</strong><button type="button" className="st-drawer-close" aria-label={t.close} onClick={() => setMenuOpen(false)}>×</button></div>
        <Routes>
          <Route path="category/:category" element={<CategoryLinks onNavigate={() => setMenuOpen(false)} />} />
          <Route path="*" element={<CategoryLinks onNavigate={() => setMenuOpen(false)} />} />
        </Routes>
      </nav>
    </div>
  );
}

function ProductCard({ product }) {
  const { slug, lang, t } = useStore();
  const name = localName(product, lang);
  const off = product.compareAtPrice ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;
  return (
    <Link to={productPath(slug, product.code)} className={`st-card${product.inStock ? "" : " st-card-out"}`}>
      {off > 0 && <span className="st-card-badge">{t.off(off)}</span>}
      <ProductImage path={product.images[0]} alt={name} code={product.code} />
      <div className="st-card-body">
        <span className="st-card-name">{name}</span>
        <span className="st-card-code" dir="ltr">{product.code}</span>
        <Price product={product} className="st-card-price" />
        {!product.inStock && <span className="st-stock st-stock-out">{t.outOfStock}</span>}
      </div>
    </Link>
  );
}

function ProductPage() {
  const { slug, store, lang, t, updateCart } = useStore();
  const { code } = useParams();
  const [state, setState] = useState({ status: "loading", product: null });
  const [active, setActive] = useState(0);
  const [qty, setQtyValue] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setState({ status: "loading", product: null });
    setActive(0); setQtyValue(1); setAdded(false);
    fetchProduct(slug, code, lang)
      .then((product) => {
        setState({ status: "ready", product });
        track("ViewContent", { content_ids: [product.code], content_type: "product", value: product.price, currency: store.currency });
      })
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

  const add = () => {
    updateCart((rows) => addToCart(rows, product, qty)); setAdded(true);
    track("AddToCart", { content_ids: [product.code], content_type: "product", value: product.price * qty, currency: store.currency });
  };
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
        <p className="st-price-row"><Price product={product} className="st-price" /></p>
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
  const { slug, store, lang, t, money, cart, updateCart, token, customer, setCustomer } = useStore();
  const [form, setForm] = useState({ name: "", mobile: "", city: "", notes: "" });
  const [gone, setGone] = useState([]); // أكواد لم تعد معروضة أو غير متوفرة
  const [formError, setFormError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null); // الطلب كما سجّله الخادم
  const zones = store.shipping?.zones || [];
  const pickupAllowed = Boolean(store.shipping?.pickupEnabled);
  const [shipMethod, setShipMethod] = useState("delivery");
  const paymentOptions = [store.payment?.cod && "cod", store.payment?.bankTransfer && "bank_transfer"].filter(Boolean);
  const [payment, setPayment] = useState(paymentOptions[0] || "cod");
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [quote, setQuote] = useState(null); // إجمالي الخادم بالاختيارات الحالية

  useEffect(() => { setMeta(`${t.cart} — ${localName(store, lang)}`, ""); }, [t, store, lang]);

  // بيانات الحساب تُعبَّأ في النموذج الفارغ فقط — لا تُمحى كتابة العميل
  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({ ...f, name: f.name || customer.name || "", mobile: f.mobile || customer.phone || "", city: f.city || customer.city || "" }));
  }, [customer]);

  const refresh = useCallback(() => {
    const codes = loadCart(slug).map((r) => r.code);
    return Promise.all(codes.map((code) => fetchProduct(slug, code, lang).then((p) => ({ code, product: p })).catch((e) => ({ code, missing: e.status === 404 }))))
      .then((results) => {
        const fresh = new Map(results.filter((r) => r.product).map((r) => [r.code, r.product]));
        setGone(results.filter((r) => r.missing || (r.product && !r.product.inStock)).map((r) => r.code));
        updateCart((rows) => rows.map((row) => (fresh.has(row.code) ? refreshRow(row, fresh.get(row.code)) : row)));
      });
  }, [slug, lang, updateCart]);
  // الأسعار والتوفر من الخادم عند فتح السلة — اللقطة المحفوظة قد تكون قديمة
  useEffect(() => { refresh(); /* مرة عند فتح الصفحة */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const orderable = cart.filter((r) => !gone.includes(r.code));
  const totals = cartTotals(orderable);
  const pickup = pickupAllowed && shipMethod === "pickup";
  // المدينة تغيّر السعر فقط حين للمتجر مناطق شحن — وإلا لا يُعاد الحساب مع كل حرف يكتبه العميل
  // مع مناطق شحن: المدينة من القائمة فقط (مدينة محفوظة في الحساب خارج القائمة تُعامَل كغير مختارة)
  const city = zones.length > 0 ? (zones.some((z) => z.city === form.city.trim()) ? form.city.trim() : "") : form.city.trim();
  const quoteCity = zones.length > 0 && !pickup ? city : "";
  const linesKey = orderable.map((r) => `${r.code}:${r.qty}`).join("|");
  useEffect(() => {
    if (!linesKey || placed) { setQuote(null); return undefined; }
    let cancelled = false;
    const lines = linesKey.split("|").map((x) => { const i = x.lastIndexOf(":"); return { code: x.slice(0, i), quantity: Number(x.slice(i + 1)) }; });
    quoteOrder(slug, { lines, shippingMethod: pickup ? "pickup" : "delivery", customer: { city: quoteCity }, couponCode: couponCode || undefined }, lang)
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch((err) => {
        if (cancelled) return;
        setQuote(null);
        // رمز خصم مرفوض: تظهر رسالة الخادم ويُزال الرمز فيعود الإجمالي بلا خصم
        if (couponCode && err.status === 400) { setCouponError(err.message || t.quoteFailed); setCouponCode(""); }
        else if (err.status === 409) refresh();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, linesKey, pickup, quoteCity, couponCode, Boolean(placed)]);
  const applyCoupon = () => { setCouponError(""); setCouponCode(couponInput.trim().toUpperCase()); };
  const shippingLabel = (o) => (o.shippingMethod === "pickup" ? t.pickup : t.delivery);
  const paymentLabel = (o) => ({ cod: t.cod, bank_transfer: t.bankTransfer }[o.paymentMethod] || "");

  if (placed) {
    const message = buildOrderMessage({
      storeName: store.name, currency: store.currency, orderNumber: placed.number,
      rows: placed.lines.map((l) => ({ code: l.code, name: l.name, qty: l.quantity, price: l.unitPrice })),
      totals: { total: placed.total, discount: placed.discountAmount, shippingFee: placed.shippingFee, shipping: shippingLabel(placed), payment: paymentLabel(placed) }, customer: { name: placed.customerName, mobile: placed.phone, city: placed.city, notes: placed.notes },
    });
    return (
      <div className="st-state st-placed">
        <h1>{t.orderPlaced(placed.number)}</h1>
        <p>{t.orderPlacedHint}</p>
        <p className="st-price">{money(placed.total)}</p>
        {placed.paymentMethod === "bank_transfer" && store.payment?.bankTransferDetails && (
          <BankDetails text={store.payment.bankTransferDetails} />
        )}
        {placed.shippingMethod === "pickup" && store.shipping?.pickupAddress && <p className="st-muted">{t.pickupAt}: {store.shipping.pickupAddress}</p>}
        <div className="st-placed-actions">
          {store.whatsappNumber && <a className="st-btn st-btn-primary" href={whatsappOrderLink(store.whatsappNumber, message)} target="_blank" rel="noopener noreferrer">{t.sendOnWhatsapp}</a>}
          {token && <Link className="st-btn st-btn-ghost" to={`${base(slug)}/account`}>{t.myOrders}</Link>}
          <Link className="st-btn st-btn-ghost" to={base(slug)}>{t.browse}</Link>
        </div>
      </div>
    );
  }

  if (cart.length === 0) return <div className="st-state"><p>{t.emptyCart}</p><Link className="st-btn" to={base(slug)}>{t.browse}</Link></div>;

  const submit = async (e) => {
    e.preventDefault();
    const clean = { name: form.name.trim(), phone: form.mobile.trim(), city: pickup ? "" : city, notes: form.notes.trim() };
    if (!clean.name || !clean.phone || (!pickup && !clean.city) || orderable.length === 0) { setFormError(pickup ? t.requiredPickup : t.required); return; }
    setFormError("");
    setPlacing(true);
    try {
      const order = await createOrder(slug, token, {
        customer: clean, lines: orderable.map((r) => ({ code: r.code, quantity: r.qty })),
        shippingMethod: pickup ? "pickup" : "delivery", paymentMethod: payment, couponCode: couponCode || undefined,
      }, lang);
      track("Purchase", { value: order.total, currency: order.currency, content_ids: order.lines.map((l) => l.code), content_type: "product" });
      updateCart(() => []);
      if (token) setCustomer((c) => (c ? { ...c, name: clean.name, city: clean.city || c.city } : c));
      setPlaced(order);
      window.scrollTo(0, 0);
    } catch (err) {
      setFormError(err.message || t.genericError);
      // صنف نفد أثناء الطلب: تُحدَّث السلة ليظهر أيّها
      if (err.status === 409) refresh();
    } finally {
      setPlacing(false);
    }
  };
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) });

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
                  <strong className="st-money">{money(row.price * row.qty)}</strong>
                  <button type="button" className="st-link" onClick={() => updateCart((rows) => removeFromCart(rows, row.code))}>{t.remove}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <aside className="st-summary">
        {quote ? (
          <dl>
            <div><dt>{t.itemsTotal}</dt><dd className="st-money">{money(quote.itemsTotal)}</dd></div>
            {quote.discount > 0 && <div className="st-discount"><dt>{t.discount}{quote.couponCode ? ` (${quote.couponCode})` : ""}</dt><dd className="st-money">−{money(quote.discount)}</dd></div>}
            {(zones.length > 0 || pickup) && <div><dt>{t.shippingFee}</dt><dd className="st-money">{pickup || quote.freeShipping ? t.free : quote.cityNotServed ? "—" : money(quote.shippingFee)}</dd></div>}
            <div><dt>{t.vat}</dt><dd className="st-money">{money(quote.vat)}</dd></div>
            <div className="st-total"><dt>{t.total}</dt><dd className="st-money">{money(quote.total)}</dd></div>
          </dl>
        ) : (
          <dl>
            <div><dt>{t.subtotal}</dt><dd className="st-money">{money(totals.exVat)}</dd></div>
            <div><dt>{t.vat}</dt><dd className="st-money">{money(totals.vat)}</dd></div>
            <div className="st-total"><dt>{t.total}</dt><dd className="st-money">{money(totals.total)}</dd></div>
          </dl>
        )}
        {store.shipping?.freeOver != null && !pickup && !(quote && quote.freeShipping) && zones.length > 0 && <p className="st-muted">{t.freeShippingHint(money(store.shipping.freeOver))}</p>}
        {quote?.belowMinimum && <p className="st-error" role="alert">{t.minOrder(money(store.minOrderAmount))}</p>}
        <div className="st-coupon">
          {couponCode && quote?.couponCode ? (
            <p className="st-coupon-on"><span>{t.coupon}: <bdi dir="ltr">{quote.couponCode}</bdi></span><button type="button" className="st-link" onClick={() => { setCouponCode(""); setCouponInput(""); }}>{t.couponRemove}</button></p>
          ) : (
            <div className="st-coupon-row">
              <input type="text" dir="ltr" maxLength={40} value={couponInput} placeholder={t.coupon} aria-label={t.coupon} onChange={(e) => { setCouponInput(e.target.value); setCouponError(""); }} />
              <button type="button" className="st-btn st-btn-ghost" disabled={!couponInput.trim()} onClick={applyCoupon}>{t.couponApply}</button>
            </div>
          )}
          {couponError && <p className="st-error" role="alert">{couponError}</p>}
        </div>
        <form onSubmit={submit} className="st-checkout">
          <h2>{t.yourDetails}</h2>
          {store.loginEnabled && !token && <p className="st-muted"><Link className="st-inline-link" to={`${base(slug)}/login?next=cart`}>{t.signInForOrders}</Link></p>}
          <label>{t.name}<input type="text" autoComplete="name" maxLength={80} {...field("name")} /></label>
          <label>{t.mobile}<input type="tel" dir="ltr" autoComplete="tel" maxLength={20} {...field("mobile")} /></label>
          {pickupAllowed && (
            <fieldset className="st-choice">
              <legend>{t.shippingMethod}</legend>
              <label><input type="radio" name="ship" checked={!pickup} onChange={() => setShipMethod("delivery")} />{t.delivery}</label>
              <label><input type="radio" name="ship" checked={pickup} onChange={() => setShipMethod("pickup")} />{t.pickup}</label>
              {pickup && store.shipping.pickupAddress && <p className="st-muted">{t.pickupAt}: {store.shipping.pickupAddress}</p>}
            </fieldset>
          )}
          {!pickup && (zones.length > 0 ? (
            <label>{t.city}
              <select value={city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
                <option value="">{t.chooseCity}</option>
                {zones.map((z) => <option key={z.city} value={z.city}>{z.city} — {z.fee > 0 ? money(z.fee) : t.free}</option>)}
              </select>
            </label>
          ) : (
            <label>{t.city}<input type="text" autoComplete="address-level2" maxLength={60} {...field("city")} /></label>
          ))}
          {paymentOptions.length > 0 && (
            <fieldset className="st-choice">
              <legend>{t.payment}</legend>
              {paymentOptions.map((p) => <label key={p}><input type="radio" name="pay" checked={payment === p} onChange={() => setPayment(p)} />{p === "cod" ? t.cod : t.bankTransfer}</label>)}
              {payment === "bank_transfer" && store.payment.bankTransferDetails && <BankDetails text={store.payment.bankTransferDetails} />}
            </fieldset>
          )}
          <label>{t.notes}<textarea rows={2} maxLength={300} {...field("notes")} /></label>
          {formError && <p className="st-error" role="alert">{formError}</p>}
          <button type="submit" className="st-btn st-btn-primary st-btn-block" disabled={placing || orderable.length === 0 || Boolean(quote?.belowMinimum)}>{placing ? t.placing : t.placeOrder}</button>
          <p className="st-muted">{t.orderPlacedHint}</p>
        </form>
      </aside>
    </div>
  );
}

/** صفحة سياسة المتجر (الاسترجاع أو الخصوصية) — نص يكتبه صاحب المتجر في إعداداته. */
function PolicyPage() {
  const { slug, store, lang, t } = useStore();
  const { kind } = useParams();
  const title = kind === "returns" ? t.returnsPolicy : t.privacyPolicy;
  const text = kind === "returns" ? store.policies?.returns : kind === "privacy" ? store.policies?.privacy : null;
  useEffect(() => { setMeta(`${title} — ${localName(store, lang)}`, ""); }, [title, store, lang]);
  if (!text) return <Navigate to={base(slug)} replace />;
  return <article className="st-policy"><h1>{title}</h1><p>{text}</p></article>;
}

function LoginPage() {
  const { slug, store, lang, t, token, signIn } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") === "cart" ? `${base(slug)}/cart` : `${base(slug)}/account`;
  const [step, setStep] = useState("phone"); // phone | code
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setMeta(`${t.signIn} — ${localName(store, lang)}`, ""); }, [t, store, lang]);
  useEffect(() => { if (token) navigate(next, { replace: true }); }, [token, next, navigate]);

  if (!store.loginEnabled) return <div className="st-state"><p>{t.noWhatsapp}</p><Link className="st-btn" to={base(slug)}>{t.browse}</Link></div>;

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); } catch (err) { setError(err.message || t.genericError); } finally { setBusy(false); }
  };
  const send = (e) => { e?.preventDefault(); if (!phone.trim()) return; run(async () => { await requestOtp(slug, phone.trim(), lang); setCode(""); setStep("code"); }); };
  const verify = (e) => { e.preventDefault(); if (!code.trim()) return; run(async () => { const r = await verifyOtp(slug, phone.trim(), code.trim(), lang); signIn(r.token, r.customer); }); };

  return (
    <div className="st-auth">
      <h1>{t.signInTitle}</h1>
      {step === "phone" ? (
        <form onSubmit={send} className="st-checkout">
          <p className="st-muted">{t.signInHint}</p>
          <label>{t.mobile}<input type="tel" dir="ltr" autoComplete="tel" inputMode="tel" maxLength={20} placeholder="05XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus /></label>
          {error && <p className="st-error" role="alert">{error}</p>}
          <button type="submit" className="st-btn st-btn-primary st-btn-block" disabled={busy || !phone.trim()}>{busy ? t.loading : t.sendCode}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="st-checkout">
          <p className="st-muted">{t.codeHint(phone.trim())}</p>
          <label>{t.codeLabel}<input type="text" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="st-code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9٠-٩]/g, ""))} autoFocus /></label>
          {error && <p className="st-error" role="alert">{error}</p>}
          <button type="submit" className="st-btn st-btn-primary st-btn-block" disabled={busy || code.trim().length < 6}>{busy ? t.loading : t.verify}</button>
          <div className="st-auth-links">
            <button type="button" className="st-link st-link-plain" onClick={() => { setStep("phone"); setError(""); }}>{t.changeNumber}</button>
            <button type="button" className="st-link st-link-plain" disabled={busy} onClick={() => send()}>{t.resend}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function AccountPage() {
  const { slug, store, lang, t, money, token, customer, setCustomer, signOut } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", city: "" });
  const [status, setStatus] = useState(null); // { ok, text }
  const [orders, setOrders] = useState(null);
  const [ordersError, setOrdersError] = useState(false);

  useEffect(() => { setMeta(`${t.account} — ${localName(store, lang)}`, ""); }, [t, store, lang]);
  useEffect(() => { if (!token) navigate(`${base(slug)}/login`, { replace: true }); }, [token, slug, navigate]);
  useEffect(() => { if (customer) setForm({ name: customer.name || "", city: customer.city || "" }); }, [customer]);
  useEffect(() => {
    if (!token) return;
    fetchMyOrders(slug, token, lang).then(setOrders).catch((e) => { if (e.status === 401) signOut(); else setOrdersError(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token]);

  if (!token) return null;

  const save = async (e) => {
    e.preventDefault();
    setStatus(null);
    try { setCustomer(await updateMe(slug, token, { name: form.name, city: form.city }, lang)); setStatus({ ok: true, text: t.saved }); }
    catch (err) { setStatus({ ok: false, text: err.message || t.genericError }); }
  };

  return (
    <div className="st-account">
      <section className="st-summary">
        <h1>{t.profile}</h1>
        <form onSubmit={save} className="st-checkout">
          <label>{t.mobile}<input type="tel" dir="ltr" value={customer?.phone || ""} readOnly /></label>
          <label>{t.name}<input type="text" autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t.city}<input type="text" autoComplete="address-level2" maxLength={60} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          {status && <p className={status.ok ? "st-added" : "st-error"} role="status">{status.text}</p>}
          <button type="submit" className="st-btn st-btn-primary">{t.save}</button>
          <button type="button" className="st-btn st-btn-ghost" onClick={() => { signOut(); navigate(base(slug)); }}>{t.signOut}</button>
        </form>
      </section>
      <section>
        <h1>{t.myOrders}</h1>
        {orders === null && !ordersError && <p className="st-state">{t.loading}</p>}
        {ordersError && <p className="st-state">{t.error}</p>}
        {orders && orders.length === 0 && <p className="st-state">{t.noOrders}</p>}
        <ul className="st-orders">
          {(orders || []).map((o) => (
            <li key={o.number}>
              <div className="st-order-head">
                <strong>{t.orderNo(o.number)}</strong>
                <span className={`st-status st-status-${o.status}`}>{t.statuses[o.status] || o.status}</span>
                <span className="st-muted" dir="ltr">{String(o.createdAt).slice(0, 10)}</span>
              </div>
              <ul className="st-order-lines">
                {o.lines.map((l) => <li key={l.code}><span>{localName(l, lang)} <small dir="ltr">× {l.quantity}</small></span><span className="st-money">{money(l.lineTotal)}</span></li>)}
              </ul>
              {o.discountAmount > 0 && <div className="st-order-extra"><span>{t.discount}{o.couponCode ? ` (${o.couponCode})` : ""}</span><span className="st-money">−{money(o.discountAmount)}</span></div>}
              {o.shippingFee > 0 && <div className="st-order-extra"><span>{t.shippingFee}</span><span className="st-money">{money(o.shippingFee)}</span></div>}
              <div className="st-order-total"><span>{t.total}</span><strong className="st-money">{money(o.total)}</strong></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** دليل المتاجر (/store) — الصفحة الأولى لتطبيق «أثر المتجر الإلكتروني»: المتاجر التي وافقت على الإدراج. */
function Directory() {
  const [lang, setLang] = useState(readLang);
  const [state, setState] = useState({ status: "loading", stores: [] });
  const [q, setQ] = useState("");
  const t = STRINGS[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* تفضيل غير محفوظ */ }
    setMeta(t.appName, t.directoryTitle);
  }, [lang, t]);

  const load = useCallback(() => {
    setState({ status: "loading", stores: [] });
    fetchDirectory(lang).then((stores) => setState({ status: "ready", stores })).catch(() => setState({ status: "error", stores: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);

  const text = q.trim().toLocaleLowerCase();
  const shown = state.stores.filter((s) => !text || `${s.name} ${s.nameEn || ""} ${s.slug}`.toLocaleLowerCase().includes(text));

  return (
    <div className="st-app">
      <header className="st-header">
        <div className="st-header-row">
          <span className="st-brand">{t.appName}</span>
          <div className="st-header-actions"><button type="button" className="st-lang" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t.langToggle}</button></div>
        </div>
        <div className="st-search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.directorySearch} aria-label={t.directorySearch} maxLength={80} /></div>
      </header>
      <main className="st-main">
        <div className="st-list-head"><h1>{t.directoryTitle}</h1></div>
        {state.status === "loading" && <p className="st-state">{t.loading}</p>}
        {state.status === "error" && <div className="st-state"><p>{t.error}</p><button className="st-btn" onClick={load}>{t.retry}</button></div>}
        {state.status === "ready" && shown.length === 0 && <p className="st-state">{t.directoryEmpty}</p>}
        <div className="st-stores">
          {shown.map((s) => (
            <Link key={s.slug} to={base(s.slug)} className="st-store-card">
              <span className="st-store-mark" aria-hidden="true">{localName(s, lang).trim().charAt(0)}</span>
              <span className="st-store-name">{localName(s, lang)}</span>
              <span className="st-store-go">{t.visitStore}</span>
            </Link>
          ))}
        </div>
      </main>
      <footer className="st-footer"><span className="st-powered">{t.poweredBy}</span></footer>
    </div>
  );
}

export default function StoreApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/store" element={<Directory />} />
        <Route path="/store/:slug/*" element={<StoreShell />} />
        <Route path="*" element={<div className="st-state"><h1>{STRINGS[readLang()].storeNotFound}</h1><p>{STRINGS[readLang()].storeNotFoundHint}</p></div>} />
      </Routes>
    </BrowserRouter>
  );
}
