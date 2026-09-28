/**
 * أعمار الذمم قبل #119 وبعده جنباً إلى جنب، لكل شركة ولكل نهاية شهر — للقراءة فقط، لا يكتب شيئاً.
 *
 * المنطقان في src/lib/agingComparison.ts ("قبل" = scripts/aging-old-logic.sql حرفياً، "بعد" = src/lib/aging.ts).
 * الفرق = بعد − قبل.
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://…" npx tsx scripts/aging-before-after.ts [2026-06 2026-07 2026-08] [--company=نمط]
 * بلا أشهر: آخر ثلاثة أشهر مكتملة. بلا --company: الشركات التي يطابق اسمها تيسم أو ارمي/أرمي.
 */
import { prisma } from "../src/lib/prisma";
import { KEYS, monthEnd, newAging, oldAging, r2, type Buckets } from "../src/lib/agingComparison";

function lastCompleteMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
  const pattern = args.find((a) => a.startsWith("--company="))?.slice("--company=".length);
  const companies = await prisma.company.findMany({
    where: pattern
      ? { name: { contains: pattern, mode: "insensitive" } }
      : { OR: [{ name: { contains: "تيسم" } }, { name: { contains: "ارمي" } }, { name: { contains: "أرمي" } }] },
    select: { id: true, tenantId: true, name: true },
    orderBy: { name: "asc" },
  });
  const list = months.length ? months : lastCompleteMonths(3);
  const lines = ["company,month_end,side,figure," + KEYS.join(",")];
  for (const c of companies) {
    for (const month of list) {
      const to = monthEnd(month);
      const [before, after] = await Promise.all([oldAging(c.id, to), newAging(c.tenantId, c.id, to)]);
      for (const side of ["receivables", "payables"] as const) {
        const b = before[side];
        const a = after[side];
        const d = Object.fromEntries(KEYS.map((k) => [k, r2(a[k] - b[k])])) as Buckets;
        for (const [label, v] of [["before (old)", b], ["after (new)", a], ["delta", d]] as const) {
          lines.push([`"${c.name}"`, to.toISOString().slice(0, 10), side, label, ...KEYS.map((k) => v[k].toFixed(2))].join(","));
        }
      }
    }
  }
  console.log(lines.join("\n"));
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
