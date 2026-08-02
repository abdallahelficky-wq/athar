/**
 * سكربت زرع بيانات تجريبية — اختياري، لتشغيل تجربة سريعة محلياً تحاكي بيانات
 * seedEntries/COMPANIES في AtharAlMuhasabi.jsx (المرجع الحي)، لمقارنة نتائج
 * التقارير المالية للـ backend الجديد رقماً برقم مع البروتوتايب كما يوصي القسم 7.
 *
 * تشغيله: npm run prisma:seed
 * (يفترض أن حساب المستأجر التجريبي تم إنشاؤه مسبقاً عبر POST /api/auth/register)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) {
    console.log("لا يوجد أي مستأجر بعد. سجّل حساباً أولاً عبر POST /api/auth/register ثم أعد تشغيل السكربت.");
    return;
  }

  const accounts = await prisma.account.findMany({ where: { tenantId: tenant.id } });
  const accountByName = new Map(accounts.map((a) => [a.name, a.id]));
  const need = (name: string) => {
    const id = accountByName.get(name);
    if (!id) throw new Error(`الحساب غير موجود: ${name}`);
    return id;
  };

  const company = await prisma.company.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "تيسم برو" } },
    update: {},
    create: { tenantId: tenant.id, name: "تيسم برو", shortName: "تيسم" },
  });

  const costCenter =
    (await prisma.costCenter.findFirst({ where: { tenantId: tenant.id, name: "محطة الجزيرة" } })) ??
    (await prisma.costCenter.create({ data: { tenantId: tenant.id, companyId: company.id, name: "محطة الجزيرة" } }));

  await prisma.journalEntry.create({
    data: {
      tenantId: tenant.id,
      companyId: company.id,
      date: new Date("2026-07-18"),
      memo: "توريد نقدية مبيعات يوم 18/7",
      status: "posted",
      sourceModule: "manual",
      lines: {
        create: [
          { accountId: need("النقدية بالصندوق"), costCenterId: costCenter.id, debit: 184500, credit: 0 },
          { accountId: need("إيرادات المبيعات"), costCenterId: costCenter.id, debit: 0, credit: 184500 },
        ],
      },
    },
  });

  await prisma.journalEntry.create({
    data: {
      tenantId: tenant.id,
      companyId: company.id,
      date: new Date("2026-07-18"),
      memo: "إيجار محطة الجزيرة - يوليو",
      status: "posted",
      sourceModule: "manual",
      lines: {
        create: [
          { accountId: need("إيجارات إدارية"), costCenterId: costCenter.id, debit: 42000, credit: 0 },
          { accountId: need("مصرف الراجحي"), costCenterId: costCenter.id, debit: 0, credit: 42000 },
          { accountId: need("الحساب البنكي الرئيسي"), costCenterId: costCenter.id, debit: 0, credit: 42000 },
        ],
      },
    },
  });

  console.log(`تم زرع بيانات تجريبية للمستأجر "${tenant.name}" (الشركة: ${company.name}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
