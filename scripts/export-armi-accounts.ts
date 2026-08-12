/**
 * سكربت قراءة فقط (read-only) — لا يعدّل أي بيانات، فقط استعلامات SELECT عبر Prisma
 * (findMany / findFirst). لا يوجد أي create/update/delete/upsert في هذا الملف.
 *
 * يسحب شجرة حسابات شركة معيّنة (افتراضياً "ارمي") من قاعدة البيانات المتصل بها DATABASE_URL —
 * الكود، الاسم، الاسم الإنجليزي، المستوى، النوع، isPosting، isArchived، isActive، isBankOrCash،
 * وكود الحساب الأب — ويكتبها إلى ملفَي CSV وJSON، ويطبعها أيضاً على الشاشة.
 *
 * الاستخدام (في بيئة عندها وصول لقاعدة الإنتاج — DATABASE_URL يشير إليها):
 *   DATABASE_URL="postgresql://...production..." npx tsx scripts/export-armi-accounts.ts
 *   DATABASE_URL="postgresql://...production..." npx tsx scripts/export-armi-accounts.ts "اسم آخر"
 *
 * إذا طابق الاسم أكثر من شركة واحدة (تينانتات مختلفة)، يطبع السكربت كل التطابقات مع
 * id/tenantId الخاص بكل واحدة، ويصدّر شجرة كل شركة في ملف منفصل — راجع الناتج واختر
 * الشركة الصحيحة يدوياً إن لزم الأمر.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  const companyName = process.argv[2] || "ارمي";

  const companies = await prisma.company.findMany({
    where: { name: { contains: companyName } },
    select: { id: true, tenantId: true, name: true, shortName: true },
  });

  if (companies.length === 0) {
    console.log(`لم يتم العثور على أي شركة باسم يحتوي على "${companyName}".`);
    return;
  }

  console.log(`تم العثور على ${companies.length} شركة مطابقة:`);
  for (const c of companies) {
    console.log(`  - ${c.name} (${c.shortName || "-"}) — companyId=${c.id} tenantId=${c.tenantId}`);
  }

  for (const company of companies) {
    const accounts = await prisma.account.findMany({
      where: { companyId: company.id },
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        nameEn: true,
        level: true,
        type: true,
        isPosting: true,
        isArchived: true,
        isActive: true,
        isBankOrCash: true,
        parent: { select: { code: true, name: true } },
      },
    });

    console.log(`\n=== ${company.name} — عدد الحسابات: ${accounts.length} ===`);

    const rows = accounts.map((a) => ({
      code: a.code,
      name: a.name,
      nameEn: a.nameEn || "",
      level: a.level,
      type: a.type,
      isPosting: a.isPosting,
      isArchived: a.isArchived,
      isActive: a.isActive,
      isBankOrCash: a.isBankOrCash,
      parentCode: a.parent?.code || "",
      parentName: a.parent?.name || "",
    }));

    console.log(JSON.stringify(rows, null, 2));

    const safeSuffix = company.id;
    const jsonPath = `armi_accounts_production_${safeSuffix}.json`;
    const csvPath = `armi_accounts_production_${safeSuffix}.csv`;

    writeFileSync(jsonPath, JSON.stringify({ company, accounts: rows }, null, 2), "utf-8");

    const header = [
      "code",
      "name",
      "nameEn",
      "level",
      "type",
      "isPosting",
      "isArchived",
      "isActive",
      "isBankOrCash",
      "parentCode",
      "parentName",
    ];
    const csvLines = [header.join(",")];
    for (const r of rows) {
      csvLines.push(
        [
          csvEscape(r.code),
          csvEscape(r.name),
          csvEscape(r.nameEn),
          String(r.level),
          r.type,
          String(r.isPosting),
          String(r.isArchived),
          String(r.isActive),
          String(r.isBankOrCash),
          csvEscape(r.parentCode),
          csvEscape(r.parentName),
        ].join(","),
      );
    }
    writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

    console.log(`تم الحفظ في: ${csvPath} و ${jsonPath}`);
  }
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ الاستعلام:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
