import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * قرار المالك (#148): عند إدخال العميل أو تعديله، عميل له رقم ضريبي (B2B — فواتيره قياسية تُخلَّص عبر زاتكا) يلزمه العنوان
 * الوطني الكامل (BR-KSA-63): الشارع، رقم المبنى (4 أرقام)، الرمز البريدي (5 أرقام)، المدينة، الحي. عميل بلا رقم ضريبي
 * (فرد / نقدي / فاتورة مبسّطة) لا يُمنَع أبداً. عبر مسارات HTTP الحقيقية.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";

const ADDRESS = { street: "شارع التحلية", buildingNo: "2345", district: "السليمانية", city: "الرياض", postalCode: "12245" };

async function call(method: string, path: string, body?: unknown, lang = "ar") {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "accept-language": lang },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

describe("customer national address is required at entry only when the customer has a VAT number", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `العنوان الوطني ${stamp}`, businessActivity: "retail", name: "المالك", email: `customer-address-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  it("creates a VAT customer with a complete national address", async () => {
    const res = await call("POST", "/customers", { companyId, name: "شركة كاملة العنوان", customerType: "business", vatNumber: "302043689600003", ...ADDRESS });
    expect(res.status, res.text).toBe(201);
  });

  it("refuses a VAT customer with missing fields, naming each one in Arabic", async () => {
    const res = await call("POST", "/customers", { companyId, name: "شركة بلا عنوان", customerType: "business", vatNumber: "302043689600003" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("العميل الذي له رقم ضريبي يلزمه العنوان الوطني كاملاً لإصدار فواتير قياسية لزاتكا — ناقص: اسم الشارع، رقم المبنى، الرمز البريدي، المدينة، الحي");
    expect(await prisma.customer.count({ where: { tenantId, name: "شركة بلا عنوان" } })).toBe(0);
  });

  it("refuses a malformed building number (4 digits) or postal code (5 digits)", async () => {
    const res = await call("POST", "/customers", { companyId, name: "شركة رقم ناقص", customerType: "business", vatNumber: "302043689600003", ...ADDRESS, buildingNo: "12", postalCode: "1224" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("رقم المبنى (يجب أن يكون 4 أرقام)، الرمز البريدي (يجب أن يكون 5 أرقام)");
  });

  it("the English message lists the same fields", async () => {
    const res = await call("POST", "/customers", { companyId, name: "No address Co", customerType: "business", vatNumber: "302043689600003", city: "Riyadh" }, "en");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A customer with a VAT number needs a complete national address to receive standard (ZATCA) invoices — missing: street name, building number, postal code, district");
  });

  it("never blocks a customer without a VAT number — individual, cash, or business without VAT", async () => {
    for (const body of [
      { name: "فرد بلا عنوان", customerType: "individual" },
      { name: "عميل نقدي", customerType: "individual", phone: "0500000000" },
      { name: "منشأة بلا رقم ضريبي", customerType: "business" },
      { name: "رقم ضريبي فارغ", customerType: "business", vatNumber: "" },
    ]) {
      const res = await call("POST", "/customers", { companyId, ...body });
      expect(res.status, `${body.name}: ${res.text}`).toBe(201);
    }
  });

  it("on update, checks the customer as it would be saved", async () => {
    const plain = await call("POST", "/customers", { companyId, name: "فرد سيصبح منشأة", customerType: "individual" });
    expect(plain.status).toBe(201);
    // تعديل حقل عادي لعميل بلا رقم ضريبي: مسموح
    expect((await call("PATCH", `/customers/${plain.body.id}`, { phone: "0511111111" })).status).toBe(200);
    // إضافة رقم ضريبي بلا عنوان: مرفوض، ولا يتغيّر شيء
    const noAddress = await call("PATCH", `/customers/${plain.body.id}`, { customerType: "business", vatNumber: "302043689600003" });
    expect(noAddress.status).toBe(400);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: plain.body.id } })).vatNumber).toBeNull();
    // مع العنوان: مسموح
    expect((await call("PATCH", `/customers/${plain.body.id}`, { customerType: "business", vatNumber: "302043689600003", ...ADDRESS })).status).toBe(200);
    // مسح حقل من عنوان عميل ضريبي: مرفوض
    const cleared = await call("PATCH", `/customers/${plain.body.id}`, { district: "" });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error).toContain("ناقص: الحي");
    // إزالة الرقم الضريبي ثم مسح العنوان: مسموح (لم يعد عميلاً ضريبياً)
    expect((await call("PATCH", `/customers/${plain.body.id}`, { customerType: "individual", vatNumber: "", district: "" })).status).toBe(200);
  });
});
