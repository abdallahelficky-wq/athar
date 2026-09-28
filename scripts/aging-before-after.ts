/**
 * أعمار الذمم قبل #119 وبعده جنباً إلى جنب، لكل شركة ولكل نهاية شهر — للقراءة فقط، لا يكتب شيئاً.
 *
 * "قبل": نفس منطق scripts/aging-old-logic.sql حرفياً (التقرير الشهري قبل #119). "بعد": src/lib/aging.ts الحالي.
 * الفرق = بعد − قبل.
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://…" npx tsx scripts/aging-before-after.ts [2026-06 2026-07 2026-08] [--company=نمط]
 * بلا أشهر: آخر ثلاثة أشهر مكتملة. بلا --company: الشركات التي يطابق اسمها تيسم أو ارمي/أرمي.
 */
import { prisma } from "../src/lib/prisma";
import { payablesAgingAsOf, receivablesAgingAsOf } from "../src/lib/aging";

type Buckets = { under30: number; d30to60: number; d60to90: number; over90: number; unallocated: number; total: number };
const KEYS: (keyof Buckets)[] = ["under30", "d30to60", "d60to90", "over90", "unallocated", "total"];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** آخر ملّي ثانية في الشهر (UTC) — نفس monthRange في reports.service.ts */
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1) - 1);
}

export async function oldAging(companyId: string, to: Date): Promise<{ receivables: Buckets; payables: Buckets }> {
  const rows = await prisma.$queryRawUnsafe<{ side: string; under30: unknown; d30to60: unknown; d60to90: unknown; over90: unknown; total: unknown }[]>(
    `WITH docs AS (
       SELECT 'receivables' AS side, i.date,
              GREATEST(i."grandTotal" - COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a."invoiceId" = i.id), 0), 0) AS due
       FROM sales_invoices i WHERE i."companyId" = $1 AND i.status = 'posted' AND i.date <= $2
       UNION ALL
       SELECT 'payables', p.date, p."grandTotal" FROM purchase_invoices p WHERE p."companyId" = $1 AND p.status = 'posted' AND p.date <= $2
     ), aged AS (SELECT *, FLOOR(EXTRACT(EPOCH FROM ($2::timestamp - date)) / 86400) AS days FROM docs)
     SELECT side,
       COALESCE(SUM(due) FILTER (WHERE days <= 30), 0) AS under30,
       COALESCE(SUM(due) FILTER (WHERE days > 30 AND days <= 60), 0) AS d30to60,
       COALESCE(SUM(due) FILTER (WHERE days > 60 AND days <= 90), 0) AS d60to90,
       COALESCE(SUM(due) FILTER (WHERE days > 90), 0) AS over90,
       COALESCE(SUM(due), 0) AS total
     FROM aged GROUP BY side`,
    companyId,
    to,
  );
  const pick = (side: string): Buckets => {
    const r = rows.find((x) => x.side === side);
    return {
      under30: r2(Number(r?.under30 ?? 0)), d30to60: r2(Number(r?.d30to60 ?? 0)), d60to90: r2(Number(r?.d60to90 ?? 0)),
      over90: r2(Number(r?.over90 ?? 0)), unallocated: 0, total: r2(Number(r?.total ?? 0)),
    };
  };
  return { receivables: pick("receivables"), payables: pick("payables") };
}

export async function newAging(tenantId: string, companyId: string, to: Date): Promise<{ receivables: Buckets; payables: Buckets }> {
  const shape = (t: { current: number; d30: number; d60: number; d90: number; unallocated: number; total: number }): Buckets => ({
    under30: t.current, d30to60: t.d30, d60to90: t.d60, over90: t.d90, unallocated: t.unallocated, total: t.total,
  });
  const [ar, ap] = await Promise.all([receivablesAgingAsOf(tenantId, companyId, to), payablesAgingAsOf(tenantId, companyId, to)]);
  return { receivables: shape(ar.totals), payables: shape(ap.totals) };
}

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
