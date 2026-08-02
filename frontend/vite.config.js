import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Vite's dev server serves every text-based response (the HTML document, but also
// every .jsx/.js/.css module and virtual module) without a `charset` parameter on
// its Content-Type header — e.g. plain "text/javascript" or "text/css". Since our
// source files are full of literal Arabic strings (labels, breadcrumbs, the sidebar
// subtitle, etc.), any response missing an explicit charset leaves the browser to
// guess the encoding, which can render those strings as "????" — this is broader
// than just the HTML document race that <meta charset> alone doesn't fully cover
// (Vite's HMR/react-refresh preamble injection pushes that tag down in the stream).
// Setting charset=utf-8 explicitly on the HTTP header for every such response
// removes the ambiguity entirely, since the header always wins over any guess.
function forceUtf8Text() {
  const TEXT_TYPES = /^(text\/html|text\/javascript|application\/javascript|text\/css|application\/json)(;|$)/i;
  const patchResponse = (res) => {
    const fixCharset = (value) =>
      typeof value === "string" && TEXT_TYPES.test(value) && !/charset/i.test(value)
        ? `${value}; charset=utf-8`
        : value;

    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) =>
      originalSetHeader(name, name.toLowerCase() === "content-type" ? fixCharset(value) : value);

    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (...args) => {
      const headersArg = args[args.length - 1];
      if (headersArg && typeof headersArg === "object") {
        for (const key of Object.keys(headersArg)) {
          if (key.toLowerCase() === "content-type") headersArg[key] = fixCharset(headersArg[key]);
        }
      }
      return originalWriteHead(...args);
    };
  };

  return {
    name: "force-utf8-text",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        patchResponse(res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        patchResponse(res);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    forceUtf8Text(),
    VitePWA({
      registerType: "autoUpdate",
      // vite-plugin-pwa يحقن سكربت تسجيل الـ Service Worker ورابط manifest.webmanifest في *كل*
      // نقاط دخول HTML تلقائياً (بما فيها mobile.html) — وهذا مقصود فعلياً هنا: عامل خدمة واحد
      // مشترك بنطاق "/" يغطي الأصل بالكامل، فبوابة الموظف تستفيد من نفس التخزين المؤقت دون
      // الحاجة لتسجيله بشكل منفصل. mobile.html تحمل بالإضافة لذلك رابط manifest-employee.webmanifest
      // الخاص بها (مذكور أولاً في <head> قبل الرابط المحقون تلقائياً) لمنحها هوية/أيقونة مستقلة
      // عند "إضافة للشاشة الرئيسية" — تكرار الرابط غير مؤذٍ عملياً (المتصفحات تعتمد أول رابط تصادفه).
      manifestFilename: "manifest.webmanifest",
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "أثر المحاسبي",
        short_name: "أثر",
        description: "نظام أثر المحاسبي — فواتير وقيود وتقارير مالية",
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        // نفس ألوان هوية التطبيق الحالية (البادج البرونزي #B98B4E فوق الكحلي #10202E في App.jsx/global.css)
        theme_color: "#10202E",
        background_color: "#ECE6D6",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // لا يُخزَّن مؤقتاً إطلاقاً أي طلب غير GET (POST/PATCH/DELETE) — نتائج مالية لا يجوز تقديمها من ذاكرة تخزين مؤقت قديمة
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => url.pathname.startsWith("/api/") && request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "athar-api-cache",
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(process.cwd(), "index.html"),
        mobile: path.resolve(process.cwd(), "mobile.html"),
      },
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
});
