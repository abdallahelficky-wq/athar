import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/**
 * حارس الإنتاج (.claude/hooks/production-guard.mjs): يُشغَّل السكربت نفسه كما يشغّله Claude Code — JSON استدعاء الأداة على
 * stdin، والقرار على stdout. استدعاءات الأدوات هنا مدخلات خارجية (ما يرسله Claude Code للخطاف)، فبناؤها يدوياً مسموح.
 * الحالات التي تعتمد على الفرع الحالي (git push بلا وجهة، git merge) تُجرَّب في مستودع git مؤقت على production وعلى فرع آخر.
 */
const GUARD = path.resolve(__dirname, "../../.claude/hooks/production-guard.mjs");

function run(tool_name: string, tool_input: Record<string, unknown>, cwd = process.cwd()) {
  const res = spawnSync("node", [GUARD], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: "utf8" });
  expect(res.status, res.stderr).toBe(0);
  if (!res.stdout.trim()) return { decision: "pass" as const, reason: "" };
  const out = JSON.parse(res.stdout).hookSpecificOutput;
  expect(out.hookEventName).toBe("PreToolUse");
  return { decision: out.permissionDecision as "deny" | "ask", reason: out.permissionDecisionReason as string };
}
const bash = (command: string, cwd?: string) => run("Bash", { command }, cwd);

let onProduction = "";
let onFeature = "";
beforeAll(() => {
  const make = (branch: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "guard-"));
    execFileSync("git", ["init", "-q", "-b", branch], { cwd: dir });
    return dir;
  };
  onProduction = make("production");
  onFeature = make("feat/some-work");
});
afterAll(() => {
  for (const d of [onProduction, onFeature]) if (d) rmSync(d, { recursive: true, force: true });
});

describe("rule 1 — .env files and printing the environment are denied", () => {
  it.each([
    ["Read", { file_path: "/home/user/athar/.env" }],
    ["Read", { file_path: "/home/user/athar/.env.production" }],
    ["Edit", { file_path: ".env.local", old_string: "a", new_string: "b" }],
    ["Write", { file_path: "/tmp/x/.env", content: "X=1" }],
    ["Grep", { pattern: "DATABASE", path: ".env" }],
    ["Grep", { pattern: "DATABASE", glob: ".env*" }],
    ["Glob", { pattern: "**/.env*" }],
  ])("%s %j", (tool, input) => {
    const r = run(tool, input);
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("القاعدة 1");
  });

  it.each([
    "cat .env",
    "head -5 .env.production",
    "source .env && npm start",
    "grep DATABASE_URL .env",
    "cp .env /tmp/leak",
    "env",
    "env | grep DATABASE",
    "printenv",
    "printenv DATABASE_URL",
    "set",
    "export -p",
    "declare -x",
    "echo $DATABASE_URL",
    'echo "${DIRECT_URL}"',
    "printf '%s' $JWT_ACCESS_SECRET",
    "cat /proc/self/environ",
    "cat /proc/1/environ | tr '\\0' '\\n'",
    "node -e 'console.log(process.env)'",
    'node -e "console.log(process.env.DATABASE_URL)"',
    "python3 -c 'import os; print(os.environ)'",
  ])("Bash: %s", (command) => {
    const r = bash(command);
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("القاعدة 1");
  });
});

describe("rule 2 — Neon and remote Postgres are denied, local Postgres passes", () => {
  it.each([
    "psql 'postgresql://u:p@ep-cool-name-123.eu-central-1.aws.neon.tech/athar?sslmode=require'",
    "curl https://console.neon.tech/api/v2/projects",
    "DATABASE_URL=postgres://u:p@db.example.com:5432/x npx prisma migrate deploy",
    "psql postgresql://u:p@10.0.0.5/athar",
    "psql postgresql://u:p@$PGHOST/athar",
  ])("Bash: %s", (command) => {
    const r = bash(command);
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("القاعدة 2");
  });

  it.each([
    "psql postgresql://test:test@localhost:5432/athar_ci -c 'select 1'",
    "DATABASE_URL=postgresql://test:test@127.0.0.1:5432/athar_test npx prisma migrate deploy",
    "psql 'postgres://test@[::1]:5432/x'",
    "export DATABASE_URL=postgresql://test:test@localhost:5432/athar_ci && npm test",
  ])("passes: %s", (command) => {
    expect(bash(command).decision).toBe("pass");
  });
});

describe("rule 3 — pushing or merging into production, and force pushes, ask", () => {
  it.each([
    "git push origin production",
    "git push -u origin HEAD:production",
    "git push origin feat/x:refs/heads/production",
    "git push --all origin",
  ])("push to production: %s", (command) => {
    const r = bash(command, onFeature);
    expect(r.decision).toBe("ask");
    expect(r.reason).toContain("القاعدة 3");
  });

  it("a bare git push while on production asks; the same on a feature branch passes", () => {
    expect(bash("git push", onProduction).decision).toBe("ask");
    expect(bash("git push origin HEAD", onProduction).decision).toBe("ask");
    expect(bash("git push", onFeature).decision).toBe("pass");
  });

  it.each([
    "git push --force origin feat/x",
    "git push -f origin feat/x",
    "git push --force-with-lease origin feat/x",
    "git push origin +feat/x",
  ])("force push anywhere: %s", (command) => {
    const r = bash(command, onFeature);
    expect(r.decision).toBe("ask");
    expect(r.reason).toContain("القاعدة 3");
  });

  it("merges: git merge on production, gh pr merge, the REST merge endpoint, and the MCP merge tool", () => {
    expect(bash("git merge feat/x", onProduction).decision).toBe("ask");
    expect(bash("git pull origin feat/x", onProduction).decision).toBe("ask");
    expect(bash("git merge origin/production", onFeature).decision).toBe("pass");
    expect(bash("gh pr merge 145 --merge").decision).toBe("ask");
    expect(bash("gh api repos/abdallahelficky-wq/athar/pulls/145/merge --method PUT").decision).toBe("ask");
    expect(bash("curl -X PUT -H 'Authorization: token x' https://api.github.com/repos/o/r/pulls/9/merge").decision).toBe("ask");
    expect(bash("gh api repos/o/r/merges -f base=production -f head=feat/x").decision).toBe("ask");
    const mcp = run("mcp__github__merge_pull_request", { owner: "o", repo: "r", pullNumber: 1 });
    expect(mcp.decision).toBe("ask");
    expect(mcp.reason).toContain("القاعدة 3");
  });
});

describe("normal work passes untouched", () => {
  it.each([
    "git status",
    "git log --oneline -3",
    "git push -u origin feat/default-sort-by-number",
    "git push -u origin chore/production-guard",
    "npm test",
    "npx vitest run src/lib/productionGuard.test.ts",
    "npx tsc -p tsconfig.json --noEmit",
    "npm run lint && npm run build",
    "gh api repos/abdallahelficky-wq/athar/pulls/145 --jq .state",
    "gh api repos/o/r/pulls --method POST --input pr.json",
    "grep -rn 'process.env.NODE_ENV' src | head",
    "env NODE_ENV=test node scripts/x.js",
    "ls -la .envrc.d 2>/dev/null; echo done",
    "echo $HOME $PATH",
  ])("Bash: %s", (command) => {
    expect(bash(command, onFeature).decision).toBe("pass");
  });

  it.each([
    ["Read", { file_path: "/home/user/athar/src/app.ts" }],
    ["Read", { file_path: "/home/user/athar/src/config/env.ts" }],
    ["Edit", { file_path: "/home/user/athar/src/lib/prisma.ts", old_string: "a", new_string: "b" }],
    ["Grep", { pattern: "process.env", path: "src" }],
    ["Glob", { pattern: "src/**/*.ts" }],
  ])("%s %j", (tool, input) => {
    expect(run(tool, input).decision).toBe("pass");
  });

  it("an unreadable payload never blocks", () => {
    const res = spawnSync("node", [GUARD], { input: "not json", encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});
