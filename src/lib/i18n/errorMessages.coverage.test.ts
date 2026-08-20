import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { AR_TO_EN } from "./errorMessages";

/** يعيد نفس منطق scripts/extractErrorStrings.mjs مضمَّناً هنا كاختبار — يمنع أي نص عربي جديد
 * يُمرَّر لدوال httpError أو كرسالة Zod (في ملفات *.schemas.ts) من المرور بصمت بلا ترجمة إنجليزية
 * في AR_TO_EN. الرسائل التفاعلية (template literals بقيم ديناميكية) مستثناة عمداً — تلك تُعالَج
 * بتحويل موقعي منفصل (انظر خطة الترجمة، الفئة 2)، لا بهذا القاموس. */

const SRC_ROOT = path.resolve(__dirname, "..", "..");
const ERROR_CALL_RE = /(?:badRequest|notFound|conflict|forbidden|unauthorized|throw new Error)\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
const ARABIC_RE = /[؀-ۿ]/;
const STRING_LIT_RE = /(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function unquote(s: string) {
  return s.slice(1, -1);
}

function isTemplateWithInterpolation(s: string) {
  return s.startsWith("`") && /\$\{/.test(s);
}

function walk(dir: string, files: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

function extractStaticStrings(): string[] {
  const found = new Set<string>();
  for (const file of walk(SRC_ROOT)) {
    const isSchemaFile = /\.schemas\.ts$/.test(file);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      if (!ARABIC_RE.test(line)) continue;
      const candidates: string[] = [];
      if (isSchemaFile) {
        let m;
        STRING_LIT_RE.lastIndex = 0;
        while ((m = STRING_LIT_RE.exec(line))) {
          if (ARABIC_RE.test(m[1])) candidates.push(m[1]);
        }
      } else {
        let m;
        ERROR_CALL_RE.lastIndex = 0;
        while ((m = ERROR_CALL_RE.exec(line))) {
          if (ARABIC_RE.test(m[1])) candidates.push(m[1]);
        }
      }
      for (const raw of candidates) {
        if (!isTemplateWithInterpolation(raw)) found.add(unquote(raw));
      }
    }
  }
  return [...found];
}

describe("backend error-message translation coverage", () => {
  it("has an English entry for every static Arabic error/validation string in the codebase", () => {
    const found = extractStaticStrings();
    const missing = found.filter((text) => !(text in AR_TO_EN));
    expect(missing).toEqual([]);
  });
});
