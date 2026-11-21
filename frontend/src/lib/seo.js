/**
 * عناوين ووصف الصفحات العامة لمحركات البحث (SEO) — مصدر واحد يُطبَّق عند كل تنقّل من SeoRoot في App.jsx.
 * القيم الافتراضية للصفحة الرئيسية مكتوبة أيضاً في index.html (لما يصل للزاحف قبل تشغيل الجافاسكربت) — عدّلهما معاً.
 * أي مسار غير مذكور هنا (شاشات النظام بعد الدخول، الدخول، الاستعادة، الدعوات) يأخذ noindex؛ وCaddyfile يرسل
 * نفس المنع كترويسة X-Robots-Tag لهذه المسارات، فلا يعتمد المنع على تشغيل الجافاسكربت.
 */
export const SITE_URL = "https://www.atharerp.com";

const DEFAULT_DESCRIPTION =
  "أثر المحاسبي نظام محاسبي سحابي عربي: فواتير إلكترونية متوافقة مع زاتكا، قيود وتقارير مالية، مخزون، أصول ثابتة، رواتب وشئون موظفين. جرّبه مجاناً لمدة شهر.";

export const PUBLIC_PAGES = {
  "/": {
    title: "أثر المحاسبي | نظام محاسبي سحابي متوافق مع زاتكا",
    description: DEFAULT_DESCRIPTION,
  },
  "/register": {
    title: "ابدأ تجربتك المجانية | أثر المحاسبي",
    description: "سجّل شركتك في أثر المحاسبي وجرّب النظام كاملاً مجاناً لمدة 30 يوماً — فواتير زاتكا، قيود، مخزون ورواتب، بدون أي التزام.",
  },
  "/download": {
    title: "تطبيقات أندرويد لفريق العمل | أثر المحاسبي",
    description: "حمّل تطبيقات أثر لأندرويد: نقطة البيع، عامل المحطة، والمتجر الإلكتروني — مرتبطة مباشرة بحسابات شركتك في أثر المحاسبي.",
  },
  "/data-protection": {
    title: "حماية البيانات وسياسة الخصوصية | أثر المحاسبي",
    description: "كيف يحمي أثر المحاسبي بيانات شركتك: عزل كامل لبيانات كل شركة، تشفير، صلاحيات، ونسخ احتياطي.",
  },
};

const NOINDEX_TITLE = "أثر المحاسبي";

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!href) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** يطبّق عنوان الصفحة ووصفها والرابط القانوني ومؤشر الفهرسة بحسب المسار الحالي. */
export function applySeoForPath(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const page = PUBLIC_PAGES[path];
  if (page) {
    const url = SITE_URL + (path === "/" ? "/" : path);
    document.title = page.title;
    setMeta("name", "description", page.description);
    setMeta("name", "robots", "index, follow");
    setMeta("property", "og:title", page.title);
    setMeta("property", "og:description", page.description);
    setMeta("property", "og:url", url);
    setCanonical(url);
  } else {
    document.title = NOINDEX_TITLE;
    setMeta("name", "robots", "noindex, nofollow");
    setCanonical(null);
  }
}
