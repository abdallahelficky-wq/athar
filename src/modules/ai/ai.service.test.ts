import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAtharAi } from "./ai.service";

const request = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", request);
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
  vi.stubEnv("CLOUDFLARE_AI_GATEWAY_ID", "test-gateway");
  vi.stubEnv("CLOUDFLARE_AI_GATEWAY_TOKEN", "test-token");
  vi.stubEnv("ATHAR_AI_MODEL", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("Cloudflare Anthropic Messages transport", () => {
  it("uses the REST endpoint and extracts assistant text content", async () => {
    request.mockResolvedValue(Response.json({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: " First " }, { type: "text", text: "Second" }],
      stop_reason: "end_turn",
    }));
    expect(await askAtharAi("Explain", { cash: 123 })).toEqual({ answer: "First \nSecond", model: "anthropic/claude-sonnet-5" });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/messages");
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-token", "cf-aig-gateway-id": "test-gateway", "cf-aig-skip-cache": "true", "cf-aig-collect-log": "false" });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model: "anthropic/claude-sonnet-5", stream: false, max_tokens: 4000 });
    expect(body.store).toBeUndefined();
    expect(body.instructions).toBeUndefined();
    expect(body.input).toBeUndefined();
    expect(typeof body.system).toBe("string");
    expect(body.messages[0].content).toContain('"cash":123');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID", "CLOUDFLARE_AI_GATEWAY_TOKEN"])("requires %s before sending data", async (name) => {
    vi.stubEnv(name, "");
    await expect(askAtharAi("Explain", {})).rejects.toThrow(name);
    expect(request).not.toHaveBeenCalled();
  });
  it("honors the configured model", async () => {
    vi.stubEnv("ATHAR_AI_MODEL", "anthropic/claude-opus-5");
    request.mockResolvedValue(Response.json({ type: "message", role: "assistant", content: [{ type: "text", text: "Answer" }] }));
    await askAtharAi("Explain", {});
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe("anthropic/claude-opus-5");
  });
  it.each([401, 429, 500])("sanitizes provider errors (%s)", async (status) => {
    request.mockResolvedValue(new Response("SECRET financial data", { status }));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502, message: `Athar AI Gateway request failed (${status})` });
  });
  it.each([
    { type: "error", error: { type: "invalid_request_error", message: "SECRET" } },
    { type: "message", content: [] },
    { type: "message", content: [{ type: "tool_use", id: "x" }] },
  ])("rejects unsuccessful, empty and non-text responses", async (body) => {
    request.mockResolvedValue(Response.json(body));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502 });
  });
  it("rejects a legacy OpenAI Responses-shaped body", async () => {
    request.mockResolvedValue(Response.json({
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "legacy shape" }] }],
    }));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502, message: "Athar AI returned an unsuccessful response" });
  });
  it("sanitizes invalid JSON and network errors", async () => {
    request.mockResolvedValue(new Response("not JSON"));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502 });
    request.mockRejectedValue(new Error("SECRET"));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502, message: "Athar AI Gateway is unavailable" });
  });
  it("reports timeouts", async () => {
    request.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 504 });
  });
});
