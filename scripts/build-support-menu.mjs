// يولّد خريطة قوائم أثر (الأقسام وتبويباتها بأسمائها العربية) من كود الواجهة نفسه — App.jsx وملفات *_TABS وar.json —
// ليستعملها «الدعم الفني» في أثر الذكي. اختبار supportKnowledge.test.ts يعيد التوليد ويقارن، فيفشل إن تغيّرت القوائم دون تحديث.
// تشغيل: node scripts/build-support-menu.mjs > src/modules/ai/supportMenu.generated.json
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fe = (p) => join(root, "frontend/src", p);

export function buildSupportMenu() {
  const app = readFileSync(fe("App.jsx"), "utf8");
  const ar = JSON.parse(readFileSync(fe("i18n/ar.json"), "utf8"));
  const tr = (key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ar);

  // مصدر كل ثابت *_TABS كما يستورده App.jsx (لا النسخ القديمة في legacy غير المستورَدة).
  const sources = {};
  for (const m of app.matchAll(/import\s+[^;{]*\{([^}]*)\}\s*from\s*"\.\/([^"]+)"/g)) {
    for (const name of m[1].split(",").map((x) => x.trim())) if (/_TABS$/.test(name)) sources[name] = m[2];
  }

  const groupsBlock = app.slice(app.indexOf("const NAV_GROUPS = ["), app.indexOf("];", app.indexOf("const NAV_GROUPS = [")));
  const groups = [];
  for (const g of groupsBlock.matchAll(/\{\s*id:\s*"([^"]+)",\s*labelKey:\s*"([^"]+)",\s*tabs:\s*([A-Z_]+_TABS)/g)) {
    const [, id, labelKey, tabsConst] = g;
    const file = readFileSync(fe(sources[tabsConst].replace(/(\.jsx?)?$/, (e) => e || ".jsx")), "utf8");
    const start = file.indexOf(`export const ${tabsConst} = `);
    let depth = 0, end = file.indexOf("[", start);
    for (; end < file.length; end++) { if (file[end] === "[") depth++; else if (file[end] === "]" && --depth === 0) break; }
    end = file.indexOf(";", end);
    const block = file.slice(start, end);
    let tabs = [...block.matchAll(/id:\s*"([^"]+)"[^}]*?labelKey:\s*"([^"]+)"/g)].map(([, tid, k]) => ({ id: tid, label: tr(k) ?? k }));
    const mapped = block.match(/\[([^\]]+)\]\.map\(id\s*=>\s*\(\{\s*id,\s*labelKey:\s*`([^`$]+)\$\{id\}`/);
    if (!tabs.length && mapped) tabs = mapped[1].match(/"([^"]+)"/g).map((q) => q.slice(1, -1)).map((tid) => ({ id: tid, label: tr(mapped[2] + tid) ?? tid }));
    groups.push({ id, label: tr(labelKey) ?? labelKey, path: `/${id}`, tabs });
  }
  return { dashboard: tr("nav.dashboard"), groups };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(buildSupportMenu(), null, 2) + "\n");
