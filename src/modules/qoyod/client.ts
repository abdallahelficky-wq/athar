export class QoyodFailure extends Error {
  constructor(public uncertain: boolean, public status?: number) { super(status ? `قيود: HTTP ${status}` : "تعذر التأكد من نتيجة الاتصال بقيود"); }
}
export async function qoyodRequest(apiKey: string, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`https://api.qoyod.com/2.0/${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "API-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new QoyodFailure(Boolean(body)); }
  // A server error may follow a successful commit. Never blindly retry POST.
  if (!response.ok) throw new QoyodFailure(Boolean(body) && (response.status >= 500 || response.status === 408), response.status);
  try { return await response.json(); } catch { throw new QoyodFailure(Boolean(body)); }
}
