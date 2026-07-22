import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react(), forceUtf8Text()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
});
