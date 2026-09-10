import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../lib/httpError";
import type { Prisma, PermissionLevel } from "@prisma/client";
import { PLATFORM_ACTIONS } from "../../lib/platformActions";
import { hasPermission } from "../../middleware/auth";

// صلاحية "فك ترحيل القيود" (وحدة الحسابات) — أول صلاحية بوليانية غير قياسية أُضيفت لهذا النظام.
const UNPOST_MODULE_ID = "accounts";
// صلاحية "البيع الآجل في نقطة البيع" (وحدة المبيعات، نقطة البيع جزء منها) — ثاني صلاحية من نفس
// النوع، بنفس النمط تماماً: عمود extra JSON بدل عمود مخصَّص، حقل allow* مخصَّص في الواجهة والمخطط.
const POS_MODULE_ID = "sales";

// أول وحدة مُهاجَرة لنظام الصلاحيات الترتيبي الجديد (PositionActionPermission) — راجع
// PLATFORM_ACTIONS في lib/platformActions.ts.
const LEAVE_REQUESTS_MODULE_ID = "leaveRequests";
const LEAVE_REQUEST_ACTION_IDS = PLATFORM_ACTIONS.leaveRequests.map((a) => a.id);

const positionInclude = {
  permissions: { where: { moduleId: { in: [UNPOST_MODULE_ID, POS_MODULE_ID] } } },
  actionPermissions: { where: { moduleId: LEAVE_REQUESTS_MODULE_ID } },
  users: { select: { id: true, name: true, identity: { select: { email: true } } } },
} satisfies Prisma.PositionInclude;

type PositionRaw = Prisma.PositionGetPayload<{ include: typeof positionInclude }>;

function publicPosition(position: PositionRaw) {
  const unpostPermission = position.permissions.find((p) => p.moduleId === UNPOST_MODULE_ID);
  const allowUnpost = Boolean((unpostPermission?.extra as Record<string, boolean> | null)?.unpost);
  const posPermission = position.permissions.find((p) => p.moduleId === POS_MODULE_ID);
  const allowPosDeferredSale = Boolean((posPermission?.extra as Record<string, boolean> | null)?.posDeferredSale);
  const leaveRequestLevels = Object.fromEntries(
    LEAVE_REQUEST_ACTION_IDS.map((actionId) => [
      actionId,
      position.actionPermissions.find((p) => p.actionId === actionId)?.level ?? "none",
    ]),
  );
  return {
    id: position.id,
    name: position.name,
    createdAt: position.createdAt,
    allowUnpost,
    allowPosDeferredSale,
    leaveRequestLevels,
    members: position.users.map((u) => ({ id: u.id, name: u.name, email: u.identity.email })),
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

export async function createPosition(
  tenantId: string,
  name: string,
  allowUnpost: boolean,
  allowPosDeferredSale: boolean,
) {
  const existing = await prisma.position.findUnique({ where: { tenantId_name: { tenantId, name } } });
  if (existing) throw conflict("يوجد بالفعل منصب بهذا الاسم");

  const permissionsToCreate: Prisma.PositionPermissionCreateWithoutPositionInput[] = [];
  if (allowUnpost) permissionsToCreate.push({ moduleId: UNPOST_MODULE_ID, extra: { unpost: true } });
  if (allowPosDeferredSale) permissionsToCreate.push({ moduleId: POS_MODULE_ID, extra: { posDeferredSale: true } });

  const position = await prisma.position.create({
    data: {
      tenantId,
      name,
      permissions: permissionsToCreate.length ? { create: permissionsToCreate } : undefined,
    },
    include: positionInclude,
  });
  return publicPosition(position);
}

/** يُحدِّث فقط الحقول المُرسَلة (allowUnpost و/أو allowPosDeferredSale) — كل صلاحية بوليانية غير
 * قياسية لها صف PositionPermission مستقل (moduleId مختلف)، فتحديث إحداهما لا يمسّ الأخرى. */
export async function updatePositionPermissions(
  tenantId: string,
  positionId: string,
  input: { allowUnpost?: boolean; allowPosDeferredSale?: boolean },
) {
  const position = await prisma.position.findFirst({ where: { id: positionId, tenantId } });
  if (!position) throw notFound("المنصب غير موجود");

  if (input.allowUnpost !== undefined) {
    await prisma.positionPermission.upsert({
      where: { positionId_moduleId: { positionId, moduleId: UNPOST_MODULE_ID } },
      create: { positionId, moduleId: UNPOST_MODULE_ID, extra: { unpost: input.allowUnpost } },
      update: { extra: { unpost: input.allowUnpost } },
    });
  }
  if (input.allowPosDeferredSale !== undefined) {
    await prisma.positionPermission.upsert({
      where: { positionId_moduleId: { positionId, moduleId: POS_MODULE_ID } },
      create: { positionId, moduleId: POS_MODULE_ID, extra: { posDeferredSale: input.allowPosDeferredSale } },
      update: { extra: { posDeferredSale: input.allowPosDeferredSale } },
    });
  }

  const updated = await prisma.position.findUniqueOrThrow({ where: { id: positionId }, include: positionInclude });
  return publicPosition(updated);
}

/** يضبط مستوى منصب واحد على إجراء واحد ضمن وحدة leaveRequests فقط (moduleId/actionId مُتحقَّق منهما
 * مسبقاً في positions.schemas.ts) — upsert لأن الصف قد لا يكون موجوداً بعد (المستوى الافتراضي none
 * حين لا يوجد صف إطلاقاً، راجع publicPosition أعلاه). */
export async function updatePositionActionPermission(
  tenantId: string,
  positionId: string,
  moduleId: string,
  actionId: string,
  level: PermissionLevel,
) {
  const position = await prisma.position.findFirst({ where: { id: positionId, tenantId } });
  if (!position) throw notFound("المنصب غير موجود");

  await prisma.positionActionPermission.upsert({
    where: { positionId_moduleId_actionId: { positionId, moduleId, actionId } },
    create: { positionId, moduleId, actionId, level },
    update: { level },
  });

  const updated = await prisma.position.findUniqueOrThrow({ where: { id: positionId }, include: positionInclude });
  return publicPosition(updated);
}

const userOverrideInclude = {
  user: { select: { id: true, name: true, identity: { select: { email: true } } } },
} satisfies Prisma.UserActionPermissionOverrideInclude;

function publicUserOverride(override: Prisma.UserActionPermissionOverrideGetPayload<{ include: typeof userOverrideInclude }>) {
  return {
    id: override.id,
    moduleId: override.moduleId,
    actionId: override.actionId,
    level: override.level,
    user: { id: override.user.id, name: override.user.name, email: override.user.identity.email },
  };
}

/** كل الاستثناءات الفردية لمستخدمي هذه الشركة (كل الوحدات المُهاجَرة، وليس leaveRequests فقط —
 * القائمة نفسها ستتسع تلقائياً مع أي وحدة مستقبلية بلا تعديل هنا). */
export async function listUserOverrides(tenantId: string) {
  const overrides = await prisma.userActionPermissionOverride.findMany({
    where: { user: { tenantId } },
    include: userOverrideInclude,
    orderBy: { createdAt: "asc" },
  });
  return overrides.map(publicUserOverride);
}

export async function upsertUserOverride(
  tenantId: string,
  input: { userId: string; moduleId: string; actionId: string; level: PermissionLevel },
) {
  const user = await prisma.user.findFirst({ where: { id: input.userId, tenantId } });
  if (!user) throw notFound("المستخدم غير موجود في هذه الشركة");

  const override = await prisma.userActionPermissionOverride.upsert({
    where: { userId_moduleId_actionId: { userId: input.userId, moduleId: input.moduleId, actionId: input.actionId } },
    create: input,
    update: { level: input.level },
    include: userOverrideInclude,
  });
  return publicUserOverride(override);
}

export async function deleteUserOverride(tenantId: string, overrideId: string) {
  const existing = await prisma.userActionPermissionOverride.findFirst({
    where: { id: overrideId, user: { tenantId } },
  });
  if (!existing) throw notFound("الاستثناء غير موجود");
  await prisma.userActionPermissionOverride.delete({ where: { id: overrideId } });
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
 * مُفوَّض صراحةً) — عبر hasPermission المشتركة في middleware/auth.ts، بصيغة قابلة للاستدعاء المباشر
 * (بلا req/res) لتضمين النتيجة في استجابة auth (login/getMe/...) حتى تعرف الواجهة متى تُظهر زر
 * "فك الترحيل" أصلاً، بدل الاعتماد فقط على رفض الخادم بعد الضغط.
 */
export async function canUnpostJournalEntries(tenantId: string, userId: string, role: string): Promise<boolean> {
  return hasPermission({ sub: userId, tenantId, role }, UNPOST_MODULE_ID, "unpost");
}

/**
 * يحدّد هل يملك هذا المستخدم صلاحية تسجيل بيع آجل (بلا دفع فوري) في نقطة البيع — نفس منطق
 * canUnpostJournalEntries أعلاه بالضبط (owner/super_admin دائماً، أو منصب مُفوَّض صراحةً عبر
 * extra.posDeferredSale على وحدة "sales")، مُضمَّنة في استجابة auth حتى تعرف شاشة نقطة البيع متى
 * تُفعِّل تبويب "آجل" أصلاً بدل الاعتماد فقط على رفض الخادم بعد الضغط — راجع pos.controller.ts
 * للتحقق المطابق في الخادم (الوحيد الحاسم فعلياً؛ هذا فقط لتجربة استخدام أفضل).
 */
export async function canDeferPosSale(tenantId: string, userId: string, role: string): Promise<boolean> {
  return hasPermission({ sub: userId, tenantId, role }, POS_MODULE_ID, "posDeferredSale");
}

/** كل مستخدمي هذه الشركة — لعرضهم في قائمة "إضافة عضو لهذا المنصب" بالواجهة. */
export async function listAssignableUsers(tenantId: string) {
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, name: true, role: true, positionId: true, identity: { select: { email: true } } },
    orderBy: { name: "asc" },
  });
  return users.map(({ identity, ...rest }) => ({ ...rest, email: identity.email }));
}
