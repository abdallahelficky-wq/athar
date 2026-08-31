import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../lib/httpError";
import type { Prisma } from "@prisma/client";

// المرحلة الأولى من نظام صلاحيات المناصب تغطي فقط صلاحية "فك ترحيل القيود" (وحدة الحسابات) — بقية
// الوحدات/الأعمدة موجودة بالبنية (Position/PositionPermission) لكن غير مُستخدَمة من هذه الشاشة بعد.
const UNPOST_MODULE_ID = "accounts";

const positionInclude = {
  permissions: { where: { moduleId: UNPOST_MODULE_ID } },
  users: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PositionInclude;

type PositionRaw = Prisma.PositionGetPayload<{ include: typeof positionInclude }>;

function publicPosition(position: PositionRaw) {
  const unpostPermission = position.permissions[0];
  const allowUnpost = Boolean((unpostPermission?.extra as Record<string, boolean> | null)?.unpost);
  return {
    id: position.id,
    name: position.name,
    createdAt: position.createdAt,
    allowUnpost,
    members: position.users,
  };
}

export async function listPositions(tenantId: string) {
  const positions = await prisma.position.findMany({
    where: { tenantId },
    include: positionInclude,
    orderBy: { createdAt: "asc" },
  });
  return positions.map(publicPosition);
}

export async function createPosition(tenantId: string, name: string, allowUnpost: boolean) {
  const existing = await prisma.position.findUnique({ where: { tenantId_name: { tenantId, name } } });
  if (existing) throw conflict("يوجد بالفعل منصب بهذا الاسم");

  const position = await prisma.position.create({
    data: {
      tenantId,
      name,
      permissions: allowUnpost ? { create: { moduleId: UNPOST_MODULE_ID, extra: { unpost: true } } } : undefined,
    },
    include: positionInclude,
  });
  return publicPosition(position);
}

export async function updatePositionUnpost(tenantId: string, positionId: string, allowUnpost: boolean) {
  const position = await prisma.position.findFirst({ where: { id: positionId, tenantId } });
  if (!position) throw notFound("المنصب غير موجود");

  await prisma.positionPermission.upsert({
    where: { positionId_moduleId: { positionId, moduleId: UNPOST_MODULE_ID } },
    create: { positionId, moduleId: UNPOST_MODULE_ID, extra: { unpost: allowUnpost } },
    update: { extra: { unpost: allowUnpost } },
  });

  const updated = await prisma.position.findUniqueOrThrow({ where: { id: positionId }, include: positionInclude });
  return publicPosition(updated);
}

export async function deletePosition(tenantId: string, positionId: string) {
  const position = await prisma.position.findFirst({ where: { id: positionId, tenantId } });
  if (!position) throw notFound("المنصب غير موجود");
  await prisma.position.delete({ where: { id: positionId } });
}

export async function assignMember(tenantId: string, positionId: string, userId: string) {
  const position = await prisma.position.findFirst({ where: { id: positionId, tenantId } });
  if (!position) throw notFound("المنصب غير موجود");

  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw notFound("المستخدم غير موجود في هذه الشركة");

  await prisma.user.update({ where: { id: userId }, data: { positionId } });
  const updated = await prisma.position.findUniqueOrThrow({ where: { id: positionId }, include: positionInclude });
  return publicPosition(updated);
}

export async function removeMember(tenantId: string, positionId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId, positionId } });
  if (!user) throw notFound("المستخدم غير مُسنَد لهذا المنصب");
  await prisma.user.update({ where: { id: userId }, data: { positionId: null } });
  const updated = await prisma.position.findUniqueOrThrow({ where: { id: positionId }, include: positionInclude });
  return publicPosition(updated);
}

/**
 * يحدّد هل يملك هذا المستخدم صلاحية فك ترحيل القيود فعلياً (owner/super_admin دائماً، أو منصب
 * مُفوَّض صراحةً) — نفس منطق requirePermission("accounts","unpost") في middleware/auth.ts بالضبط،
 * لكن كدالة قابلة للاستدعاء المباشر (بلا req/res) لتضمين النتيجة في استجابة auth (login/getMe/...)
 * حتى تعرف الواجهة متى تُظهر زر "فك الترحيل" أصلاً، بدل الاعتماد فقط على رفض الخادم بعد الضغط.
 */
export async function canUnpostJournalEntries(tenantId: string, userId: string, role: string): Promise<boolean> {
  if (role === "super_admin") return true;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerId: true } });
  if (tenant?.ownerId === userId) return true;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { positionId: true } });
  if (!user?.positionId) return false;

  const permission = await prisma.positionPermission.findUnique({
    where: { positionId_moduleId: { positionId: user.positionId, moduleId: UNPOST_MODULE_ID } },
  });
  return Boolean((permission?.extra as Record<string, boolean> | null)?.unpost);
}

/** كل مستخدمي هذه الشركة — لعرضهم في قائمة "إضافة عضو لهذا المنصب" بالواجهة. */
export async function listAssignableUsers(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId },
    select: { id: true, name: true, email: true, role: true, positionId: true },
    orderBy: { name: "asc" },
  });
}
