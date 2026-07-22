import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite's dev middleware injects the HMR/react-refresh preamble as the very first
// child of <head>, ahead of <meta charset="UTF-8">. That doesn't corrupt the file
// on disk, but some browsers sniff the response before reaching the (now pushed-down)
// charset tag and briefly render the Arabic <title> with a guessed encoding, showing
// "????" until they recover. Setting the charset on the HTTP header itself removes
// the ambiguity entirely, since the header always wins over any <meta> tag.
function forceUtf8Html() {
  return {
    name: "force-utf8-html",
    configureServer(server) {
      // Scoped to the top-level document navigation only (path has no file
      // extension). Patches setHeader/writeHead directly — rather than racing
      // Vite's own internal middleware that sets Content-Type later in the
      // chain — so a bare "text/html" is always upgraded to include the charset,
      // regardless of which middleware sets it last. Every other response
      // (JS/CSS/virtual modules) is left completely untouched.
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        const isDocumentRequest =
          (req.method === "GET" || req.method === "HEAD") &&
          !url.includes(".") && !url.startsWith("/@") && !url.startsWith("/src/");
        if (!isDocumentRequest) return next();

        const fixCharset = (value) =>
          typeof value === "string" && /^text\/html(;|$)/i.test(value) && !/charset/i.test(value)
            ? "text/html; charset=utf-8"
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

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), forceUtf8Html()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
});
