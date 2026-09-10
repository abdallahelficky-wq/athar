import "express-async-errors";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { jwtAccessSecret: "test-only-access-secret", jwtAccessExpiresIn: "15m" } }));
vi.mock("../../lib/prisma", () => ({ prisma: { company: { findFirst: vi.fn() } } }));
vi.mock("../dashboard/dashboard.service", () => ({
  getFinancialKpis: vi.fn(), getFinancialPosition: vi.fn(), getCashBreakdown: vi.fn(),
  getCashFlowMonthly: vi.fn(), getSalesTrend: vi.fn(), getTopCustomers: vi.fn(), getFinancialAlerts: vi.fn(),
}));
vi.mock("./ai.service", () => ({ askAtharAi: vi.fn() }));
import { aiRoutes } from "./ai.routes";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import * as dashboard from "../dashboard/dashboard.service";
import { askAtharAi } from "./ai.service";
import { HttpError } from "../../lib/httpError";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRoutes);
  app.use(((err, _req, res, _next) => { res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }); }) as express.ErrorRequestHandler);
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai/ask`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "company-a" } as never);
  for (const fn of Object.values(dashboard)) vi.mocked(fn).mockResolvedValue([] as never);
  vi.mocked(dashboard.getFinancialKpis).mockResolvedValue({ salesCurrent: 123 } as never);
  vi.mocked(askAtharAi).mockResolvedValue({ answer: "تحليل", model: "anthropic/claude-sonnet-5" });
});
function post(body: unknown, scope: string | null = "company-a", tenantId = "tenant-a") {
  const token = scope === null ? "" : signAccessToken({ sub: "user-a", tenantId, role: "admin", companyScope: scope, readOnly: false });
  return fetch(base, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
function noDataRead() {
  expect(prisma.company.findFirst).not.toHaveBeenCalled();
  for (const fn of Object.values(dashboard)) expect(fn).not.toHaveBeenCalled();
  expect(askAtharAi).not.toHaveBeenCalled();
}
describe("POST /api/ai/ask", () => {
  it("requires authentication", async () => { expect((await post({ question: "Explain" }, null)).status).toBe(401); noDataRead(); });
  it.each([{}, { question: "" }, { question: "x".repeat(4001) }, { question: "Explain", context: { cash: 999 } }, { question: "Explain", tenantId: "other" }, { question: "Explain", companyScope: "all" }, { question: "Explain", dateFrom: "invalid" }, { question: "Explain", dateTo: "2026-02-30" }])("rejects malformed or arbitrary financial context", async (body) => {
    expect((await post(body)).status).toBe(400); noDataRead();
  });
  it.each([["", "tenant-a"], ["company-a", ""]])("fails closed on empty scope claims", async (scope, tenant) => {
    expect((await post({ question: "Explain" }, scope, tenant)).status).toBe(401); noDataRead();
  });
  it("rejects attempts to select another company", async () => {
    expect((await post({ question: "Explain", companyId: "company-b" })).status).toBe(403); noDataRead();
  });
  it("builds scoped context on the server and returns the answer", async () => {
    const response = await post({ question: " Explain " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answer: "تحليل", scope: { companyId: "company-a" } });
    expect(prisma.company.findFirst).toHaveBeenCalledWith({ where: { id: "company-a", tenantId: "tenant-a" }, select: { id: true } });
    for (const fn of Object.values(dashboard)) expect(vi.mocked(fn).mock.calls[0].slice(0, 2)).toEqual(["tenant-a", "company-a"]);
    expect(askAtharAi).toHaveBeenCalledWith("Explain", expect.objectContaining({ kpis: { salesCurrent: 123 }, periods: expect.any(Object) }));
  });
  it("allows tenant-wide scope only for an all-company token", async () => {
    expect((await post({ question: "Explain" }, "all", "tenant-b")).status).toBe(200);
    for (const fn of Object.values(dashboard)) expect(vi.mocked(fn).mock.calls[0].slice(0, 2)).toEqual(["tenant-b", undefined]);
  });
  it("allows an all-company user to select a company within their tenant", async () => {
    expect((await post({ question: "Explain", companyId: "company-b" }, "all")).status).toBe(200);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({ where: { id: "company-b", tenantId: "tenant-a" }, select: { id: true } });
    for (const fn of Object.values(dashboard)) expect(vi.mocked(fn).mock.calls[0].slice(0, 2)).toEqual(["tenant-a", "company-b"]);
  });
  it("rejects a missing or cross-tenant company before loading financial data", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null);
    expect((await post({ question: "Explain", companyId: "foreign-company" }, "all")).status).toBe(404);
    for (const fn of Object.values(dashboard)) expect(fn).not.toHaveBeenCalled();
    expect(askAtharAi).not.toHaveBeenCalled();
  });
  it("rejects reversed date ranges", async () => {
    expect((await post({ question: "Explain", dateFrom: "2026-09-09", dateTo: "2026-09-01" })).status).toBe(400);
    expect(askAtharAi).not.toHaveBeenCalled();
  });
  it("propagates a sanitized gateway failure", async () => {
    vi.mocked(askAtharAi).mockRejectedValue(new HttpError(502, "Athar AI Gateway is unavailable"));
    const response = await post({ question: "Explain" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Athar AI Gateway is unavailable" });
  });
});
