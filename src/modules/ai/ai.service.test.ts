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

describe("Cloudflare Responses transport", () => {
  it("uses the REST endpoint and extracts assistant output after reasoning items", async () => {
    request.mockResolvedValue(Response.json({ status: "completed", output: [
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content: [
        { type: "output_text", text: " First " }, { type: "output_text", text: "Second" },
      ] },
    ] }));
    expect(await askAtharAi("Explain", { cash: 123 })).toEqual({ answer: "First \nSecond", model: "openai/gpt-5.6-sol" });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/responses");
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-token", "cf-aig-gateway-id": "test-gateway", "cf-aig-skip-cache": "true", "cf-aig-collect-log": "false" });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model: "openai/gpt-5.6-sol", store: false, stream: false });
    expect(body.tools).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(body.input[0].content).toContain('"cash":123');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID", "CLOUDFLARE_AI_GATEWAY_TOKEN"])("requires %s before sending data", async (name) => {
    vi.stubEnv(name, "");
    await expect(askAtharAi("Explain", {})).rejects.toThrow(name);
    expect(request).not.toHaveBeenCalled();
  });
  it("honors the configured model", async () => {
    vi.stubEnv("ATHAR_AI_MODEL", "openai/gpt-5.6-sol");
    request.mockResolvedValue(Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Answer" }] }] }));
    await askAtharAi("Explain", {});
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe("openai/gpt-5.6-sol");
  });
  it.each([401, 429, 500])("sanitizes provider errors (%s)", async (status) => {
    request.mockResolvedValue(new Response("SECRET financial data", { status }));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502, message: `Athar AI Gateway request failed (${status})` });
  });
  it.each([
    { status: "incomplete", output: [] },
    { status: "failed", error: { message: "SECRET" }, output: [] },
    { status: "completed", output: [] },
    { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "No" }] }] },
    { choices: [{ message: { content: "legacy" } }] },
  ])("rejects unsuccessful, empty, refusal and legacy responses", async (body) => {
    request.mockResolvedValue(Response.json(body));
    await expect(askAtharAi("Explain", {})).rejects.toMatchObject({ status: 502 });
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
