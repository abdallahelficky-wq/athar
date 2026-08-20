import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "src");
const ERROR_CALL_RE = /(?:badRequest|notFound|conflict|forbidden|unauthorized|throw new Error)\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
const ARABIC_RE = /[؀-ۿ]/;
const STRING_LIT_RE = /(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function unquote(s) {
  return s.slice(1, -1);
}

function isTemplateWithInterpolation(s) {
  return s.startsWith("`") && /\$\{/.test(s);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

const files = walk(ROOT);
const staticStrings = new Map(); // text -> [{file, line}]
const interpolated = []; // {file, line, raw}

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const isSchemaFile = /\.schemas\.ts$/.test(rel);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (!ARABIC_RE.test(line)) return;
    const candidates = [];
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
      if (isTemplateWithInterpolation(raw)) {
        interpolated.push({ file: rel, line: idx + 1, raw });
      } else {
        const text = unquote(raw);
        if (!staticStrings.has(text)) staticStrings.set(text, []);
        staticStrings.get(text).push(`${rel}:${idx + 1}`);
      }
    }
  });
}

const staticList = [...staticStrings.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
writeFileSync(
  "/tmp/claude-0/-home-user-athar/34183382-16ce-56d1-961e-19dbe31f1b74/scratchpad/static_strings.json",
  JSON.stringify(staticList.map(([text, locs]) => ({ text, locs })), null, 2),
);
writeFileSync(
  "/tmp/claude-0/-home-user-athar/34183382-16ce-56d1-961e-19dbe31f1b74/scratchpad/interpolated_strings.json",
  JSON.stringify(interpolated, null, 2),
);

console.log("static distinct:", staticList.length);
console.log("interpolated occurrences:", interpolated.length);
