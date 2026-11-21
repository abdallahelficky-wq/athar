import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cloudflareClientIp, isCloudflareIp, resolveClientIp } from "./clientIp";
import { publicRateLimit } from "./publicRateLimit";

// المدخلات هنا طلبات HTTP (تصل من الخارج فعلاً)، والمُخرَج req.ip يُقرأ من Express نفسه بعد trust proxy
// والوسيط الحقيقي — كما يحدث في app.ts (trust proxy = 1 ثم cloudflareClientIp).
let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function start(app: express.Express): Promise<string> {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function appEchoingIp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cloudflareClientIp);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe("isCloudflareIp", () => {
  it("يعرف عناوين Cloudflare v4 وv6 والمحوّلة، ويرفض غيرها", () => {
    expect(isCloudflareIp("172.70.1.1")).toBe(true);
    expect(isCloudflareIp("::ffff:162.158.10.20")).toBe(true);
    expect(isCloudflareIp("2606:4700::1")).toBe(true);
    expect(isCloudflareIp("153.52.255.51")).toBe(false);
    expect(isCloudflareIp("10.0.0.1")).toBe(false);
    expect(isCloudflareIp(undefined)).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
  });
});

describe("resolveClientIp", () => {
  it("يتجاهل ترويسة غير صالحة", () => {
    expect(resolveClientIp("172.70.1.1", "garbage")).toBe("172.70.1.1");
  });
});

describe("cloudflareClientIp عبر HTTP", () => {
  it("طلب عبر Cloudflare: req.ip = CF-Connecting-IP لا عنوان خادم Cloudflare", async () => {
    const base = await start(appEchoingIp());
    const res = await fetch(`${base}/ip`, { headers: { "X-Forwarded-For": "5.6.7.8, 172.70.1.1", "CF-Connecting-IP": "5.6.7.8" } });
    expect((await res.json()).ip).toBe("5.6.7.8");
  });

  it("طلب مباشر (ليس من Cloudflare) يرسل CF-Connecting-IP مزيّفاً: يُتجاهَل", async () => {
    const base = await start(appEchoingIp());
    const res = await fetch(`${base}/ip`, { headers: { "X-Forwarded-For": "9.9.9.9", "CF-Connecting-IP": "1.1.1.1" } });
    expect((await res.json()).ip).toBe("9.9.9.9");
  });

  it("حدّ الطلبات يفصل عميلين خلف خادم Cloudflare نفسه", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(cloudflareClientIp);
    app.use(publicRateLimit({ windowMs: 60_000, max: 1 }));
    app.get("/x", (_req, res) => res.json({ ok: true }));
    app.use(((_err, _req, res, _next) => res.status(429).end()) as express.ErrorRequestHandler);
    const base = await start(app);
    const via = (client: string) =>
      fetch(`${base}/x`, { headers: { "X-Forwarded-For": `${client}, 172.70.1.1`, "CF-Connecting-IP": client } }).then((r) => r.status);
    expect(await via("5.6.7.8")).toBe(200);
    expect(await via("5.6.7.8")).toBe(429);
    // عميل آخر من نفس خادم Cloudflare: عدّاد مستقل، لا يُحجَب بسبب الأول
    expect(await via("8.8.4.4")).toBe(200);
  });
});
