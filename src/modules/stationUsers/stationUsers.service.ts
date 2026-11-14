import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { hashPassword } from "../../lib/password";

/**
 * مستخدمو تطبيق المحطات (عمّال ومشرفون) — مستقلون عن شئون الموظفين: لا راتب ولا رواتب. كل عملية مقيَّدة بمستأجر الطلب، والمحطة
 * يجب أن تكون مركز تكلفة من نفس المستأجر والشركة. الحذف لمن لا ورديات له ولا رسائل فقط؛ وإلا الأرشفة (توقف الدخول وتُبقي
 * السجل لورديّاته). الرمز لا يخرج أبداً — hasPin فقط.
 */
type Role = "worker" | "supervisor";

const SELECT = {
  id: true, companyId: true, costCenterId: true, role: true, name: true, phone: true, active: true, archivedAt: true,
  lockedUntil: true, createdAt: true, updatedAt: true, migratedFromEmployeeId: true, costCenter: { select: { name: true } },
} as const;

async function view(id: string) {
  const u = await prisma.stationUser.findUniqueOrThrow({ where: { id }, select: { ...SELECT, pinHash: true } });
  const [shifts, openShift] = await Promise.all([
    prisma.stationShift.count({ where: { stationUserId: id } }),
    prisma.stationShift.findFirst({ where: { stationUserId: id, status: "open" }, select: { id: true } }),
  ]);
  const { pinHash, costCenter, ...rest } = u;
  return { ...rest, stationName: costCenter?.name ?? null, hasPin: Boolean(pinHash), shiftsCount: shifts, hasOpenShift: Boolean(openShift) };
}

async function owned(tenantId: string, id: string) {
  const u = await prisma.stationUser.findFirst({ where: { id, tenantId }, select: { id: true, companyId: true, costCenterId: true, role: true, phone: true } });
  if (!u) throw notFound("مستخدم المحطات غير موجود");
  return u;
}

async function assertStation(tenantId: string, companyId: string, costCenterId: string | null | undefined, role: Role) {
  if (role === "worker" && !costCenterId) throw badRequest("اختر محطة العامل");
  if (!costCenterId) return null;
  const station = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, companyId }, select: { id: true } });
  if (!station) throw notFound("المحطة غير موجودة");
  return station.id;
}

async function assertPhoneFree(tenantId: string, phone: string, exceptId?: string) {
  const clash = await prisma.stationUser.findFirst({ where: { tenantId, phone, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw conflict("رقم الجوال هذا مستخدم لمستخدم محطات آخر");
}

export async function listStationUsers(tenantId: string, companyId: string) {
  // شركة من مستأجر آخر (أو غير موجودة): 404 صريح بدل قائمة فارغة
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  const rows = await prisma.stationUser.findMany({ where: { tenantId, companyId }, select: { id: true }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }] });
  return Promise.all(rows.map((r) => view(r.id)));
}

export async function createStationUser(tenantId: string, input: { companyId: string; name: string; role: Role; costCenterId?: string | null; phone: string; pin: string }) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  const costCenterId = await assertStation(tenantId, company.id, input.costCenterId, input.role);
  await assertPhoneFree(tenantId, input.phone);
  const u = await prisma.stationUser.create({
    data: { tenantId, companyId: company.id, name: input.name, role: input.role, costCenterId, phone: input.phone, pinHash: await hashPassword(input.pin), active: true },
    select: { id: true },
  });
  return view(u.id);
}

export async function updateStationUser(
  tenantId: string, id: string,
  input: { name?: string; role?: Role; costCenterId?: string | null; phone?: string; pin?: string; active?: boolean },
) {
  const u = await owned(tenantId, id);
  const role = input.role ?? (u.role as Role);
  const nextStation = input.costCenterId !== undefined ? input.costCenterId : u.costCenterId;
  const costCenterId = await assertStation(tenantId, u.companyId, nextStation, role);
  if (costCenterId !== u.costCenterId || role !== u.role) {
    // العامل في وردية مفتوحة يقفلها أولاً — نقله لمحطة أخرى أو تغيير دوره يقطع ورديته
    const open = await prisma.stationShift.findFirst({ where: { stationUserId: id, status: "open" }, select: { id: true } });
    if (open) throw badRequest("لهذا العامل وردية مفتوحة — يجب إقفالها قبل تغيير محطته أو دوره");
  }
  if (input.phone && input.phone !== u.phone) await assertPhoneFree(tenantId, input.phone, id);
  await prisma.stationUser.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      role, costCenterId,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.pin ? { pinHash: await hashPassword(input.pin), failedLoginAttempts: 0, lockedUntil: null, lockoutCount: 0 } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  return view(id);
}

export async function archiveStationUser(tenantId: string, id: string) {
  await owned(tenantId, id);
  const open = await prisma.stationShift.findFirst({ where: { stationUserId: id, status: "open" }, select: { id: true } });
  if (open) throw badRequest("لهذا العامل وردية مفتوحة — يجب إقفالها قبل أرشفته");
  await prisma.stationUser.update({ where: { id }, data: { archivedAt: new Date(), active: false } });
  return view(id);
}

export async function restoreStationUser(tenantId: string, id: string) {
  const u = await owned(tenantId, id);
  if (u.phone) await assertPhoneFree(tenantId, u.phone, id);
  await prisma.stationUser.update({ where: { id }, data: { archivedAt: null, active: true } });
  return view(id);
}

export async function deleteStationUser(tenantId: string, id: string) {
  await owned(tenantId, id);
  const [shifts, messages] = await Promise.all([
    prisma.stationShift.count({ where: { stationUserId: id } }),
    prisma.stationMessage.count({ where: { fromStationUserId: id } }),
  ]);
  if (shifts || messages) throw conflict("لهذا المستخدم ورديات أو رسائل مسجّلة — أرشفه بدل الحذف");
  await prisma.stationUser.delete({ where: { id } });
  return { id, deleted: true };
}
