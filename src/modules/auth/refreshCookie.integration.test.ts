import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "./auth.service";
import { REFRESH_COOKIE_NAME } from "../../lib/refreshCookie";

/**
 * رمز التجديد في كوكي httpOnly، عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * - وضع الكوكي (X-Athar-Refresh-Mode: cookie): الرمز في Set-Cookie (HttpOnly، Path=/api/auth، SameSite=Lax) لا في الجسم؛
 * - /refresh بالكوكي وحده يعمل ويدوّر الرمز، والكوكي القديم بعد التدوير مرفوض؛
 * - /logout بالكوكي يُبطل الجلسة ويمسح الكوكي؛
 * - العملاء القدامى بلا الترويسة: الرمز يبقى في الجسم كما كان ويعمل /refresh به.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `refresh-cookie-${stamp}@example.com`;
const password = "Str0ng-Pass!";
let tenantId = "";
let server: Server;
let baseUrl = "";

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") || "" };
}

function cookieValue(setCookie: string): string {
  const match = new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  return match ? decodeURIComponent(match[1]) : "";
}

const COOKIE_MODE = { "x-athar-refresh-mode": "cookie" };

describe("refresh token in an httpOnly cookie (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await register({ tenantName: "مستأجر كوكي التجديد", businessActivity: "retail", name: "المالك", email, password });
    tenantId = result.tenant.id;
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("cookie mode: token only in an httpOnly cookie; refresh rotates via the cookie; logout revokes and clears it", async () => {
    const login = await post("/auth/login", { email, password }, COOKIE_MODE);
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.setCookie).toMatch(/HttpOnly/i);
    expect(login.setCookie).toMatch(/Path=\/api\/auth/i);
    expect(login.setCookie).toMatch(/SameSite=Lax/i);
    const first = cookieValue(login.setCookie);
    expect(first).toBeTruthy();

    const refreshed = await post("/auth/refresh", {}, { ...COOKIE_MODE, cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(first)}` });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.body.refreshToken).toBeUndefined();
    const second = cookieValue(refreshed.setCookie);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    // الرمز القديم بعد التدوير مرفوض
    const reused = await post("/auth/refresh", {}, { ...COOKIE_MODE, cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(first)}` });
    expect(reused.status).toBe(401);

    const out = await post("/auth/logout", {}, { ...COOKIE_MODE, cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(second)}` });
    expect(out.status).toBe(204);
    expect(out.setCookie).toMatch(new RegExp(`${REFRESH_COOKIE_NAME}=;`));
    const afterLogout = await post("/auth/refresh", {}, { cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(second)}` });
    expect(afterLogout.status).toBe(401);
  });

  it("legacy clients (no header) still get the token in the body and can refresh with it", async () => {
    const login = await post("/auth/login", { email, password });
    expect(login.status).toBe(200);
    expect(typeof login.body.refreshToken).toBe("string");
    const refreshed = await post("/auth/refresh", { refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.refreshToken).toBe("string");
  });

  it("refresh with neither body token nor cookie is a 401, not a validation crash", async () => {
    const res = await post("/auth/refresh", {});
    expect(res.status).toBe(401);
  });
});
