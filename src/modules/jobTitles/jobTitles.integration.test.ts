import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * الوظائف والمناصب عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * 1) شؤون الموظفين تضيف الوظائف وتعيد تسميتها، والمشاهد لا يعدّلها؛
 * 2) المنصب يُبنى من وظيفة قائمة أو جديدة، منصب واحد لكل وظيفة، واسمه يتبعها، ولا تُحذَف وظيفة لها منصب؛
 * 3) مستأجران شركتاهما بالاسم نفسه ووظائفهما بالأسماء نفسها: لا يرى أحدهما وظائف الآخر ولا يبني منها منصباً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const password = "Str0ng-Pass!";
const emails: string[] = [];
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

type Tenant = { tenantId: string; ownerToken: string };
let a: Tenant;
let b: Tenant;

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function registerTenant(label: string): Promise<Tenant> {
  const email = `jobtitles-${label}-${stamp}@example.com`;
  emails.push(email);
  const owner = await register({ tenantName: "شركة مكررة الاسم", businessActivity: "retail", name: `مالك ${label}`, email, password });
  tenantIds.push(owner.tenant.id);
  return { tenantId: owner.tenant.id, ownerToken: owner.accessToken };
}

async function memberToken(t: Tenant, role: "hr_manager" | "viewer") {
  const email = `jobtitles-${role}-${t.tenantId}@example.com`;
  emails.push(email);
  const identity = await prisma.identity.create({ data: { email } });
  const user = await prisma.user.create({ data: { tenantId: t.tenantId, identityId: identity.id, name: role, role, inviteStatus: "accepted" } });
  return signAccessToken({ sub: user.id, tenantId: t.tenantId, role, companyScope: "all", readOnly: false });
}

const names = (body: { name: string }[]) => body.map((j) => j.name);

describe("job titles and positions (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await registerTenant("a");
    b = await registerTenant("b");
  }, 60_000);

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      // حذف المستأجر يحذف مناصبه ووظائفه معاً رغم أن المنصب يمنع حذف وظيفته منفردة
      await prisma.tenant.delete({ where: { id: tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId } });
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("1) HR adds and renames job titles; a viewer cannot change them", async () => {
    const hr = await memberToken(a, "hr_manager");
    const viewer = await memberToken(a, "viewer");

    const created = await call("POST", "/job-titles", hr, { name: "  مشرف مبيعات  " });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "مشرف مبيعات", positionId: null });
    expect((await call("POST", "/job-titles", hr, { name: "مشرف مبيعات" })).status).toBe(409);
    expect((await call("POST", "/job-titles", viewer, { name: "فني" })).status).toBe(403);
    expect((await call("PATCH", `/job-titles/${created.body.id}`, viewer, { name: "فني" })).status).toBe(403);

    const renamed = await call("PATCH", `/job-titles/${created.body.id}`, hr, { name: "مشرف مبيعات أول" });
    expect(renamed.status).toBe(200);
    expect(names((await call("GET", "/job-titles", viewer)).body)).toContain("مشرف مبيعات أول");
    expect((await call("DELETE", `/job-titles/${created.body.id}`, hr)).status).toBe(204);
    expect(names((await call("GET", "/job-titles", hr)).body)).not.toContain("مشرف مبيعات أول");
  });

  it("2) a position is built from an existing or new job title, one per title, and follows its name", async () => {
    const existing = await call("POST", "/job-titles", a.ownerToken, { name: "محاسب" });
    const fromExisting = await call("POST", "/positions", a.ownerToken, { jobTitleId: existing.body.id });
    expect(fromExisting.status).toBe(201);
    expect(fromExisting.body).toMatchObject({ name: "محاسب", jobTitleId: existing.body.id });
    // وظيفة لها منصب: لا منصب ثانٍ لها، بالمعرّف أو بالاسم
    expect((await call("POST", "/positions", a.ownerToken, { jobTitleId: existing.body.id })).status).toBe(409);
    expect((await call("POST", "/positions", a.ownerToken, { jobTitleName: "محاسب" })).status).toBe(409);

    // وظيفة جديدة من شاشة المناصب: تُنشأ وتظهر في قائمة الوظائف مرتبطة بمنصبها
    const fromNew = await call("POST", "/positions", a.ownerToken, { jobTitleName: "مشرف محطة" });
    expect(fromNew.status).toBe(201);
    const titles = (await call("GET", "/job-titles", a.ownerToken)).body as { name: string; positionId: string | null }[];
    expect(titles.find((j) => j.name === "مشرف محطة")?.positionId).toBe(fromNew.body.id);
    // الطلب يحدد وظيفة واحدة بالضبط
    expect((await call("POST", "/positions", a.ownerToken, {})).status).toBe(400);
    expect((await call("POST", "/positions", a.ownerToken, { jobTitleId: existing.body.id, jobTitleName: "x" })).status).toBe(400);

    // إعادة تسمية الوظيفة تعيد تسمية منصبها، وحذفها مرفوض ما دام لها منصب
    const jobId = fromNew.body.jobTitleId as string;
    expect((await call("PATCH", `/job-titles/${jobId}`, a.ownerToken, { name: "مشرف محطات" })).status).toBe(200);
    const positions = (await call("GET", "/positions", a.ownerToken)).body as { id: string; name: string }[];
    expect(positions.find((p) => p.id === fromNew.body.id)?.name).toBe("مشرف محطات");
    expect((await call("DELETE", `/job-titles/${jobId}`, a.ownerToken)).status).toBe(409);
    // بعد حذف المنصب تُحذَف الوظيفة
    expect((await call("DELETE", `/positions/${fromNew.body.id}`, a.ownerToken)).status).toBe(204);
    expect((await call("DELETE", `/job-titles/${jobId}`, a.ownerToken)).status).toBe(204);
  });

  it("3) two tenants with same-named companies and job titles stay apart", async () => {
    const aTitle = await call("POST", "/job-titles", a.ownerToken, { name: "فني صيانة" });
    const bTitle = await call("POST", "/job-titles", b.ownerToken, { name: "فني صيانة" });
    expect(bTitle.status).toBe(201);
    expect(bTitle.body.id).not.toBe(aTitle.body.id);

    const bList = (await call("GET", "/job-titles", b.ownerToken)).body as { id: string }[];
    expect(bList.map((j) => j.id)).not.toContain(aTitle.body.id);
    expect((await call("PATCH", `/job-titles/${aTitle.body.id}`, b.ownerToken, { name: "اختراق" })).status).toBe(404);
    expect((await call("DELETE", `/job-titles/${aTitle.body.id}`, b.ownerToken)).status).toBe(404);
    // لا يبني مستأجر منصباً من وظيفة مستأجر آخر
    expect((await call("POST", "/positions", b.ownerToken, { jobTitleId: aTitle.body.id })).status).toBe(404);
    // والاسم نفسه عند المستأجر الآخر يبني من وظيفته هو
    const bPosition = await call("POST", "/positions", b.ownerToken, { jobTitleName: "فني صيانة" });
    expect(bPosition.body.jobTitleId).toBe(bTitle.body.id);
    expect((await prisma.jobTitle.findUniqueOrThrow({ where: { id: aTitle.body.id } })).name).toBe("فني صيانة");
  });
});
