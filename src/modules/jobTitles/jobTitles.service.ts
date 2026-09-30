import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../lib/httpError";

/**
 * الوظائف (المسمّيات الوظيفية) على مستوى المستأجر كله — شؤون الموظفين ← الوظائف. كل وظيفة قد يُبنى منها منصب
 * واحد يحمل صلاحياتها (Position.jobTitleId)، فاسم المنصب يتبع اسم وظيفته عند إعادة التسمية، ولا تُحذَف وظيفة
 * لها منصب. مسمّى الموظف نفسه يبقى نصاً حراً (Employee.jobTitle) تقترحه الواجهة من هذه القائمة.
 */
const include = { position: { select: { id: true } } } satisfies Prisma.JobTitleInclude;

function publicJobTitle(row: Prisma.JobTitleGetPayload<{ include: typeof include }>) {
  return { id: row.id, name: row.name, positionId: row.position?.id ?? null };
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function listJobTitles(tenantId: string) {
  const rows = await prisma.jobTitle.findMany({ where: { tenantId }, include, orderBy: { name: "asc" } });
  return rows.map(publicJobTitle);
}

export async function createJobTitle(tenantId: string, name: string) {
  try {
    return publicJobTitle(await prisma.jobTitle.create({ data: { tenantId, name }, include }));
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("هذه الوظيفة موجودة بالفعل");
    throw err;
  }
}

export async function renameJobTitle(tenantId: string, id: string, name: string) {
  const existing = await prisma.jobTitle.findFirst({ where: { id, tenantId }, include });
  if (!existing) throw notFound("الوظيفة غير موجودة");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.jobTitle.update({ where: { id }, data: { name }, include });
      // المنصب المبني من هذه الوظيفة يحمل اسمها
      if (row.position) await tx.position.update({ where: { id: row.position.id }, data: { name } });
      return row;
    });
    return publicJobTitle(updated);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("يوجد وظيفة أو منصب بهذا الاسم بالفعل");
    throw err;
  }
}

export async function deleteJobTitle(tenantId: string, id: string) {
  const existing = await prisma.jobTitle.findFirst({ where: { id, tenantId }, include });
  if (!existing) throw notFound("الوظيفة غير موجودة");
  if (existing.position) throw conflict("لا يمكن حذف وظيفة لها منصب — احذف المنصب أولاً من شاشة المناصب");
  await prisma.jobTitle.delete({ where: { id } });
}
