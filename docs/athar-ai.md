# Athar AI (read-only)

`POST /api/ai/ask` requires an Athar access token. The body accepts only `question`
(1–4000 characters), optional `companyId`, and optional `dateFrom` / `dateTo`
in YYYY-MM-DD format (inclusive UTC dates). Unknown fields, including `context`,
`tenantId`, and `companyScope`, are rejected. Company scope comes from the signed
access token; selected companies must belong to its tenant. Missing scope claims
fail closed. An `all` scope may query all companies within that tenant.

The controller builds financial context from scoped dashboard/report reads.
Metric period descriptions accompany the context because some metrics are current
or all-time even when a requested range is supplied. The model receives no tools,
database credentials, or write capability. Responses are returned as text only.

## Railway / Cloudflare configuration

Set these on the backend service in the intended non-production environment:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account containing the gateway.
- `CLOUDFLARE_AI_GATEWAY_ID`: gateway ID within that account, not a URL.
- `CLOUDFLARE_AI_GATEWAY_TOKEN`: Cloudflare API token with **Account > Workers AI > Read**
  for that account. An AI Gateway-only token cannot authenticate this REST API.
- `ATHAR_AI_MODEL=anthropic/claude-sonnet-5`.

Third-party model requests require funded Cloudflare Unified Billing and access to
the selected model. These settings are loaded on use; other backend endpoints can
start without AI credentials. Never commit real values or put them in frontend variables.

The transport uses
`https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/messages`
(Anthropic's Messages API schema), Bearer authentication and `cf-aig-gateway-id`.
The request body uses `system` for instructions, `messages` for the conversation,
and a required `max_tokens: 4000`. It skips the gateway cache and disables gateway
content logs. Requests time out after 60 seconds. Provider error bodies are neither
logged nor returned; incomplete, failed, empty, non-text and malformed responses
(including a legacy OpenAI Responses-shaped body) are rejected.

References: [Cloudflare REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
and [Anthropic provider on Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/providers/anthropic/).

## Verification

Run `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm run build`, and `npm test`.
For the existing backend tests, make OpenSSL available on PATH and supply test-only
`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and a random base64-encoded
32-byte `ZATCA_ENCRYPTION_KEY`. CI supplies these without production secrets. The PDF
rendering test is skipped unless `CHROMIUM_EXECUTABLE_PATH` is set.
CI runs these checks on feature branch pushes and pull requests with read-only
repository permissions. AI HTTP tests bind an ephemeral loopback port, use real
signed test tokens, and mock dashboard/database reads and the provider. Transport
tests separately verify the Cloudflare URL, headers, request and response handling.
They do not prove live Cloudflare account permissions or database connectivity.

After configuring a non-production backend, send an authenticated request with
`{"question":"لخص الوضع المالي","companyId":"<authorized-company-id>"}` to
`/api/ai/ask`. Expect HTTP 200 with `answer`, `model`, and `scope`. Also verify 401
without a token, 400 with a `context` field, and 403 for a company outside a restricted
token's scope. A 502 mentioning upstream 401 indicates token/account permissions;
other upstream failures require checking account credits and model availability.
Do not merge to the default branch or release Production before checks and the
live non-production verification succeed.
