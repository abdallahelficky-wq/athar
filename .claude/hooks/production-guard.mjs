#!/usr/bin/env node
/**
 * حارس الإنتاج — خطاف PreToolUse لأدوات Claude Code وحدها (لا يمسّ أوامر المالك في طرفيته).
 *
 *   القاعدة 1 (منع):  ملفات .env / .env.* بأي أداة، وطباعة متغيّرات البيئة (env، printenv، set، export -p،
 *                     echo $DATABASE_URL، /proc/<pid>/environ، process.env كاملاً).
 *   القاعدة 2 (منع):  أي أمر فيه neon.tech، أو رابط postgres:// / postgresql:// لمضيف غير localhost / 127.0.0.1 / ::1.
 *   القاعدة 3 (سؤال): git push إلى production، git push --force إلى أي فرع، والدمج في production
 *                     (git merge على production، gh pr merge، نقطة REST للدمج عبر gh api أو curl، أداة MCP للدمج).
 *                     في الوضع التلقائي (permission_mode = "auto") يُجيب مُصنِّف الوضع التلقائي عن «السؤال» لا المالك،
 *                     فيصير السؤال منعاً هناك (قرار المالك، #146)؛ في بقية الأوضاع يبقى سؤالاً يصل إليه.
 *
 * يُكتب القرار على stdout بصيغة hookSpecificOutput (deny / ask) ويخرج بـ0؛ لا قرار = يمرّ الأمر كالمعتاد.
 * التعطيل: احذف مدخل PreToolUse من .claude/settings.json، أو "disableAllHooks": true في .claude/settings.local.json.
 * الاختبار: src/lib/productionGuard.test.ts (يشغّل هذا الملف نفسه).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROTECTED_BRANCH = "production";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const MSG = {
  envFile: (what) =>
    `⛔ حارس الإنتاج — القاعدة 1 (ملفات البيئة): ممنوع الوصول إلى ${what}. ملفات .env و.env.* تحمل أسرار الإنتاج ولا يقرؤها Claude Code ولا يعدّلها.`,
  envPrint: (what) =>
    `⛔ حارس الإنتاج — القاعدة 1 (متغيّرات البيئة): ممنوع طباعة متغيّرات البيئة (${what}). قد تحمل روابط قاعدة الإنتاج ومفاتيحها.`,
  neon: () =>
    "⛔ حارس الإنتاج — القاعدة 2 (قاعدة الإنتاج): الأمر يشير إلى neon.tech. Claude Code لا يتصل بقاعدة Neon إطلاقاً؛ استخدم Postgres محلياً مؤقتاً على localhost.",
  remotePg: (host) =>
    `⛔ حارس الإنتاج — القاعدة 2 (قاعدة الإنتاج): رابط Postgres إلى مضيف غير محلي (${host}). المسموح فقط localhost أو 127.0.0.1.`,
  pushProduction: () =>
    "⚠️ حارس الإنتاج — القاعدة 3: هذا دفع (git push) إلى فرع production مباشرة. يحتاج تأكيدك.",
  pushForce: () =>
    "⚠️ حارس الإنتاج — القاعدة 3: هذا دفع قسري (git push --force) يعيد كتابة تاريخ فرع. يحتاج تأكيدك.",
  merge: (how) => `⚠️ حارس الإنتاج — القاعدة 3: هذا دمج قد يصل إلى production (${how}). يحتاج تأكيدك.`,
  autoMode: (reason) =>
    `⛔ ${reason.replace(/^⚠️\s*/, "")} الجلسة في الوضع التلقائي، فلا يصل هذا السؤال إليك — مُنِع. نفّذ الأمر بنفسك، أو بدّل الجلسة إلى الوضع العادي ثم اطلبه مرة أخرى.`,
};

// ---------- القاعدة 1: ملفات البيئة ----------
const ENV_BASENAME = /^\.env(\..+)?$/;
// .env كاسم ملف داخل أمر: قبله فاصل أو / (لا حرف — process.env ليس ملفاً)، وبعده نهاية أو فاصل
const ENV_IN_COMMAND = /(^|[\s/'"=:<>(`;|&])\.env(\.[\w.-]+)?(?=$|[\s'"/;|&)<>`])/;

function envFilePath(p) {
  if (typeof p !== "string" || !p) return false;
  const base = p.split(/[\\/]/).pop();
  return ENV_BASENAME.test(base) || /(^|[\\/])\.env(\.[^\\/]+)?([\\/]|$)/.test(p);
}

const SENSITIVE_VAR = /\$\{?#?([A-Za-z_][A-Za-z0-9_]*)/g;
const SENSITIVE_NAME = /(DATABASE|DIRECT_URL|_URL$|URL$|SECRET|TOKEN|PASSWORD|PASSWD|PASS$|KEY|CREDENTIAL|^PG|NEON|JWT|ZATCA|AWS_|GITHUB|GH_)/i;

/** أجزاء الأمر المركّب: ; && || | والأسطر الجديدة، مع تجاهل الفواصل داخل علامات الاقتباس */
function segments(command) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === ";" || c === "\n" || c === "|" || c === "&") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** كلمات الجزء بعد إسقاط تعيينات البادئة (VAR=x cmd) وsudo/command/exec/time/nohup */
function words(segment) {
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || ["sudo", "command", "exec", "time", "nohup", "(", "{", "$(", "`"].includes(tokens[i]))) i++;
  return tokens.slice(i).map((t) => t.replace(/^["'`(]+|["'`)]+$/g, ""));
}

function checkEnvPrinting(command) {
  if (/\/proc\/[^\s/]+\/environ/.test(command)) return MSG.envPrint("/proc/*/environ");
  // process.env كاملاً (لا process.env.X ولا process.env["X"])
  if (/process\.env(?![\s]*[.[?\w])/.test(command)) return MSG.envPrint("process.env");
  if (/os\.environ(?![\s]*[.[\w])/.test(command)) return MSG.envPrint("os.environ");
  // متغيّر حسّاس بعينه من داخل سكربت سطر أوامر (node -e / python -c): process.env.DATABASE_URL، os.environ["..."]
  for (const m of command.matchAll(/(?:process\.env(?:\.|\[\s*["'`])|os\.environ(?:\.get\(|\[)\s*["']?|getenv\(\s*["'])([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (SENSITIVE_NAME.test(m[1])) return MSG.envPrint(m[1]);
  }
  for (const seg of segments(command)) {
    const w = words(seg);
    const cmd = w[0];
    if (!cmd) continue;
    if (cmd === "printenv") return MSG.envPrint("printenv");
    // env وحده (أو بخيارات طباعة فقط) يطبع كل البيئة؛ env VAR=x cmd يشغّل أمراً ولا يطبع
    if (cmd === "env" && w.slice(1).every((a) => /^-/.test(a) && !/^-(u|-unset|C|-chdir|S|-split-string)$/.test(a))) return MSG.envPrint("env");
    if (cmd === "set" && w.length === 1) return MSG.envPrint("set");
    if ((cmd === "export" || cmd === "declare" || cmd === "typeset") && (w.length === 1 || w.slice(1).some((a) => /^-[a-zA-Z]*[px]/.test(a)) && w.slice(1).every((a) => a.startsWith("-")))) return MSG.envPrint(cmd);
    if (cmd === "echo" || cmd === "printf" || cmd === "print") {
      for (const m of seg.matchAll(SENSITIVE_VAR)) if (SENSITIVE_NAME.test(m[1])) return MSG.envPrint(`${cmd} $${m[1]}`);
    }
  }
  return null;
}

function checkEnvFileInCommand(command) {
  const m = command.match(ENV_IN_COMMAND);
  if (!m) return null;
  return MSG.envFile(`.env${m[2] ?? ""}`);
}

// ---------- القاعدة 2: قاعدة الإنتاج ----------
function checkDatabase(command) {
  if (/neon\.tech/i.test(command)) return MSG.neon();
  for (const m of command.matchAll(/postgres(?:ql)?:\/\/([^\s'"`]*)/gi)) {
    const rest = m[1];
    const authority = rest.split(/[/?#]/)[0];
    const hostPort = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
    const host = hostPort.startsWith("[") ? hostPort.slice(0, hostPort.indexOf("]") + 1) : hostPort.split(":")[0];
    // قائمة مضيفين (host1,host2) أو مضيف فارغ/متغيّر — كلها غير مقبولة إلا إن كان كل مضيف محلياً
    const hosts = host.split(",").filter(Boolean);
    if (hosts.length === 0 || hosts.some((h) => !LOCAL_HOSTS.has(h.toLowerCase()))) return MSG.remotePg(host || "غير محدد");
  }
  return null;
}

// ---------- القاعدة 3: الدفع والدمج ----------
function currentBranch(cwd) {
  try {
    // symbolic-ref يعمل أيضاً على فرع بلا commits بعد؛ HEAD منفصل ⇒ خطأ ⇒ null (لا يُعتبر production)
    return execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

function gitArgs(w) {
  // git [-C dir] [-c k=v] ... <sub> args
  let i = 1;
  while (i < w.length && w[i].startsWith("-")) i += ["-C", "-c", "--git-dir", "--work-tree"].includes(w[i]) ? 2 : 1;
  return { sub: w[i], args: w.slice(i + 1) };
}

function refspecTargetsProtected(spec) {
  const s = spec.replace(/^\+/, "");
  const dst = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s;
  return dst === PROTECTED_BRANCH || dst === `refs/heads/${PROTECTED_BRANCH}`;
}

function checkGit(command, cwd) {
  let branch;
  const onProtected = () => (branch ??= currentBranch(cwd)) === PROTECTED_BRANCH;
  for (const seg of segments(command)) {
    const w = words(seg);
    if (w[0] === "git") {
      const { sub, args } = gitArgs(w);
      if (sub === "push") {
        if (args.some((a) => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) && !a.startsWith("--")) || args.some((a) => /^\+/.test(a))) return { decision: "ask", reason: MSG.pushForce() };
        if (args.some((a) => a === "--all" || a === "--mirror")) return { decision: "ask", reason: MSG.pushProduction() };
        const positional = args.filter((a) => !a.startsWith("-"));
        const refspecs = positional.slice(1);
        if (refspecs.some(refspecTargetsProtected)) return { decision: "ask", reason: MSG.pushProduction() };
        if (refspecs.length === 0 || refspecs.includes("HEAD")) { if (onProtected()) return { decision: "ask", reason: MSG.pushProduction() }; }
      }
      if ((sub === "merge" || sub === "pull") && onProtected()) return { decision: "ask", reason: MSG.merge(`git ${sub} على فرع production`) };
    }
    if (w[0] === "gh" && w[1] === "pr" && w[2] === "merge") return { decision: "ask", reason: MSG.merge("gh pr merge") };
    if ((w[0] === "gh" && w[1] === "api") || w[0] === "curl" || w[0] === "wget" || w[0] === "http" || w[0] === "xh") {
      if (/\/pulls\/\d+\/merge\b/.test(seg) || /repos\/[^/\s]+\/[^/\s]+\/merges\b/.test(seg)) return { decision: "ask", reason: MSG.merge("نقطة REST للدمج") };
    }
  }
  return null;
}

// ---------- التوجيه حسب الأداة ----------
export function decide(input) {
  const result = decideRule(input);
  // القاعدة 3 في الوضع التلقائي: لا أحد يسأل المالك هناك، فالسؤال منع
  if (result?.decision === "ask" && input.permission_mode === "auto") return { decision: "deny", reason: MSG.autoMode(result.reason) };
  return result;
}

function decideRule(input) {
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();

  if (tool === "Bash" || tool === "PowerShell") {
    const command = String(ti.command || "");
    const deny =
      checkEnvFileInCommand(command) ||
      checkEnvPrinting(command) ||
      checkDatabase(command);
    if (deny) return { decision: "deny", reason: deny };
    return checkGit(command, cwd);
  }
  if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const p = ti.file_path || ti.notebook_path || ti.path;
    if (envFilePath(p)) return { decision: "deny", reason: MSG.envFile(p) };
    return null;
  }
  if (tool === "Grep" || tool === "Glob") {
    for (const p of [ti.path, ti.glob, ti.pattern && tool === "Glob" ? ti.pattern : null]) {
      if (typeof p === "string" && (envFilePath(p) || /(^|[\\/*{,])\.env(\b|\*|\.)/.test(p))) return { decision: "deny", reason: MSG.envFile(p) };
    }
    return null;
  }
  if (/merge_pull_request$/.test(tool)) return { decision: "ask", reason: MSG.merge(`أداة ${tool}`) };
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return; // مدخل غير مفهوم: لا قرار (لا نعطّل كل الأدوات بسبب خلل في الحارس)
  }
  const result = decide(input);
  if (!result) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

const invokedDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) main();
