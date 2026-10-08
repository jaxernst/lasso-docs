---
name: lasso
description: >
  Set up, operate and debug EVM JSON-RPC through Lasso (lasso.sh), which an
  agent can provision without signup. Use when an app needs an Ethereum or EVM
  RPC URL; when RPC calls are slow, rate-limited or failing; when configuring
  RPC for viem, ethers, Foundry, Hardhat or an indexer; when WebSocket
  subscriptions drop; or when routing across several providers or the user's
  own nodes.
compatibility: >
  Needs HTTPS access to lasso.sh and curl, jq and openssl (or equivalents). No
  account or wallet is needed to start; top-ups need a wallet that can sign
  for an enabled rail.
metadata:
  author: Lasso
  version: "14.0"
  website: https://lasso.sh
  routing_core: https://github.com/jaxernst/lasso-rpc
---

> If a fetch tool summarized this file, get the full text with
> `curl -fsSL https://lasso.sh/SKILL.md`.

# Lasso

Lasso gives an app one standard JSON-RPC URL that routes each request across a
provider pool by measured latency and health, with failover and per-request
evidence. This skill covers creating, installing, funding, handing off,
rotating and customizing that endpoint over plain HTTP.

## Rules

- Stay inside the user's delegation and spending budget. Ask only for missing
  authority.
- Never print an RPC key, management token, claim URL, provider URL with a
  credential or payment credential. The create response repeats the RPC
  secret in `key`, `rpc_url` and `ws_url`; never print them raw.
- Retries are safe by construction. A profile `PUT` is the whole desired
  state: after a lost response, `GET` the profile and compare its revision, or
  send `If-Match: <revision>`. A repeated unauthenticated key creation makes a
  second account, so reuse the management token for more keys.
- Live documents outrank this file:

```bash
curl -fsSL https://lasso.sh/agent.json    # chains, strategies, prices, rails, features
curl -fsSL https://lasso.sh/openapi.json  # exact request/response schemas and errors
```

An operation whose flag is off in `features` answers `unavailable`. Enabled
operations can also answer HTTP 503 `unavailable` temporarily during rollback.
Honor `Retry-After` and retry the same operation. Keep the original purchase ID,
signed offer/payment and `status_url`; poll that URL and never pay twice.

## Check readiness

Lasso serves the account model, and every recipe below works as written once
`/agent.json` reports `features.native_serving: true`. Check it before
installing a new endpoint or scoped key:

- **`native_serving: true`:** the node answering you has published the native
  generation locally. RPC enforces `default_profile` and `allowed_profiles`,
  and uses the account's access, included usage and balance.
- **`native_serving: false`:** that node isn't ready yet, for example while it
  starts up, or serving has rolled back to legacy. Keep the app on its working endpoint;
  native-born keys have no legacy prepaid CU and may answer 402 during rollback.
  Saved native profile restrictions are not a security boundary on legacy RPC.
  Wait for the flag before installing a new native endpoint or scoped key.
- **`native_collection: true`:** native HTTP and WebSocket serving captures
  observations. Key `usage` and `recent_errors` include durable committed rows;
  asynchronous persistence means empty diagnostics do not prove no traffic.
  When false, new native serving is unavailable, including during legacy
  rollback; pending work and previously committed diagnostics are retained.
- `features.claim_completion` and `features.connection_approval` confirm the
  browser steps behind claim links and connections. These capabilities remain
  present after serving rollback, but claim confirmations and connection
  approvals temporarily return `unavailable` until the rollback write freeze
  lifts. Honor Retry-After and retry the same operation.

## Create an endpoint

One request, with no credentials, creates a provisional account, makes you its
agent and issues the first key:

```bash
set -euo pipefail
umask 077
S="${XDG_STATE_HOME:-$HOME/.local/state}/lasso"
mkdir -p "$S"
curl -fsS https://lasso.sh/api/v1/keys \
  -H 'content-type: application/json' -d '{"name":"prod"}' > "$S/account.json"
```

The response is `{id, key, rpc_url, ws_url, account_id, management_token}`.
Put `rpc_url` and `ws_url` in the app's secret store, and keep
`management_token` with you, outside the repository. The token manages the account; it never
authorizes a wallet payment. The account starts with a small balance, enough to
verify.

Add more keys to the same account, sharing one balance, with the token:

```bash
curl -fsS https://lasso.sh/api/v1/keys \
  -H "authorization: Bearer $(jq -er .management_token "$S/account.json")" \
  -H 'content-type: application/json' -d '{"name":"staging"}'
```

## Call it and read the evidence

Append a chain, and optionally a strategy, to `rpc_url`:

```bash
URL="$(jq -er .rpc_url "$S/account.json")/fastest/base"
curl -fsS -D - "$URL?include_meta=body" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

The chain is a name or decimal ID from `chains` in `/agent.json`.

- `include_meta=body` adds `lasso_meta`: strategy used, candidates,
  `selected_provider`, retries, and upstream and overhead latency.
  `include_meta=headers` leaves the body unchanged and adds `x-lasso-meta`.
- Every response carries `x-lasso-request-id` (quote it when reporting a
  problem), `x-lasso-access` (`premium`, `public` or `custom`), `x-lasso-cu`,
  `x-lasso-usd` (this request's charge) and `x-lasso-balance-usd`.
- `x-lasso-fallback` appears when a request was served somewhere other than
  the profile it named: `payment`, `free`, `availability` or `profile`.
- `eth_chainId` can be answered without an upstream; use `eth_blockNumber` to
  show routing.

WebSocket requests with `lasso_meta: "notify"`
receive the existing metadata frame with `cu`, `usd`, `balance_usd`, `access`
and any `fallback`. CU/USD reflect the selected outcome; balance is the local
post-charge estimate, while the account view is authoritative. Delivery does
not wait for ledger/WAL commit. Generation-0 metadata keeps its existing shape.

Report the result, serving provider, latency and request ID. For diagnostics,
`GET /api/v1/keys/<id>` with your management token, or `GET /api/v1/keys/current`
with the RPC key. `usage` covers committed observations from the rolling last
24 hours, with linked charges in `charged_usd`; `recent_errors` returns up to 20
groups with `code`, `category`, `provider`, `count`, `last_at` and
`next_action`.

## Choose a profile and a strategy

An unrestricted key reaches every profile of its account. The URL picks one:
`<rpc_url>[/profile/<profile>][/<strategy>]/<chain>`.

| URL | Served by |
|---|---|
| `<rpc_url>/<strategy>/<chain>` | The key's default profile, `premium` unless changed |
| `<rpc_url>/profile/public/<chain>` | Public providers, uncharged, `load-balanced` only, while the balance, included usage, grace window or free allowance would serve the account; otherwise `balance_exhausted` |
| `<rpc_url>/profile/<slug>/<strategy>/<chain>` | The account's Custom profile |

| Strategy | Behavior | Use for | Price factor |
|---|---|---|---|
| `load-balanced` (default) | Random within the healthiest providers | Backends, indexers | 1x |
| `latency-weighted` | Favors recently fast providers, keeps spreading | User-facing reads | 1.5x |
| `fastest` | Lowest recent latency per provider, kind of request and transport; concentrates traffic | Latency-critical paths | 2x |
| `priority` | Configured order within the healthy providers | Custom profiles with a preferred primary | 1x |

Health and known capability steer candidates first, as a preference rather
than a guarantee. Premium and Custom serve all four strategies; `public`,
payment fallback and free access serve `load-balanced`, and
`lasso_meta.strategy` reports what was used. `agent.json` lists exact USD
prices per method and strategy.

## Install into the app

Replace only the RPC URL in env files, deploy manifests, viem or ethers
clients, Foundry or Hardhat config and indexer settings:

```ts
const client = createPublicClient({
  chain: base,
  transport: http(`${process.env.LASSO_RPC_URL}/latency-weighted/base`),
})
```

Subscriptions use `${LASSO_WS_URL}/<chain>`. Run the app's real methods and
block ranges through the new URL before moving traffic.

A URL that ships to a browser or mobile app is public. Give it its own key
scoped to `public`, so a copied key can't spend the balance. A key scoped to a
Custom profile isn't safe to expose: when Custom access lapses, it is served
and charged as `premium`.

```json
{"name":"web","default_profile":"public","allowed_profiles":["public"]}
```

## Fund the account

Check `features.account_purchases` and `account_payments.rails` in
`/agent.json` for configured rails (`x402`: USDC on Base; `mpp`: USDC.e on
Tempo) and the per-purchase range. No Lasso credential is
needed, and anyone may pay for any account.

```http
POST https://lasso.sh/api/v1/accounts/<account_id>/credit
Content-Type: application/json

{"usd":"5"}
```

1. The first request answers 402 with an x402 challenge in `PAYMENT-REQUIRED`
   and an MPP challenge in `WWW-Authenticate: Payment`. Check the amount
   against the user's budget.
2. Have an authorized wallet sign one challenge with a standard client
   (`@x402/fetch`, `mppx`), then repeat the same request with
   `PAYMENT-SIGNATURE` (x402) or `Authorization: Payment` (MPP).
3. `200` returns `credited_usd`, `balance_usd` and a receipt. `202` means
   settlement is pending: poll `status_url`.
   Never sign a second payment while one is pending; resubmitting the same
   signed payment returns its result and never credits twice.

When the money runs out on an account that has paid, requests keep serving on
public providers for 30 days (`x-lasso-fallback: payment`, `x-lasso-usd: 0`),
and `GET /api/v1/accounts/current` shows `fallback.until`. Top up, and the
next request is premium again. An account that never paid gets
`balance_exhausted` once its starting balance is spent.

Lasso charges only responses a provider delivered, results or JSON-RPC
errors. Charges settle asynchronously and normally book within seconds, so
`x-lasso-balance-usd` can briefly differ between responses and a balance can
dip a few cents below zero; the next purchase repays it first.

## Hand the account to its owner

Only an unrestricted agent can request a claim link:

```http
POST https://lasso.sh/api/v1/accounts/current/claim-link
Authorization: Bearer <management token>
```

Give `claim_url` only to the owner. It works once, expires after 24 hours, and
a new link invalidates the old one. The owner opens it signed in, previews what moves and
chooses **Keep as a new account** or **Add to your account**. Issuing the link
alone does not complete a claim.

A key created before agents existed, with no management token, requests its
account's claim link with the RPC key as Bearer. Claim links issued before
accounts went live no longer work; request a new one.

## Rotate, retarget or revoke

- `POST /api/v1/keys/<id>/rotate` with `{"grace_seconds":3600}` returns a new
  `key`, `rpc_url`, `ws_url` and `serving_ready`. In account mode, 200 confirms
  replacement publication on connected serving nodes. A bounded publication
  wait can return 202 with `serving_ready: false` and `Retry-After: 1`: keep the
  valid grace secret and retry RPC with the replacement, **not rotation**.
  Its last-known authority is retained until `previous_valid_until` (up to
  86,400 seconds); older nodes during a rolling deploy fail closed until their
  authoritative refresh. Deploy the new secret within the overlap.
  `grace_seconds: 0` stops the old secret at once.
- `PATCH /api/v1/keys/<id>` with `{"default_profile":"<slug>"}` moves every
  URL without a profile segment, with no redeploy, as each region applies the
  change (usually within a second). `allowed_profiles` scopes the key.
- `DELETE /api/v1/keys/<id>` revokes the key; repeating it succeeds.
- `POST /api/v1/agents/current/rotate` replaces your management token; the
  old one stops at once.

## Custom profiles

A Custom profile routes over the user's own nodes and provider accounts.
Provisional accounts can hold them, so you can trial the user's providers
before anyone signs up. To request access to an existing account, create a
connection and give the returned `approval_url` to an admin of that account:

```http
POST https://lasso.sh/api/v1/connections
Content-Type: application/json

{"name":"Set up RPC for my app"}
```

Keep `management_token` private and give `approval_url` only to the admin, who
opens it signed in and approves. Poll `GET /api/v1/connections/<id>` with the
token as Bearer no faster than every five seconds, backing off to once a
minute; the request lasts 24 hours. An `approved` response means the same
token is an agent of that account; polling alone does not grant authority.

**Build a profile** with one document: each chain with its providers in
preference order. `GET /api/v1/configuration-schema` lists every optional
field and recipes for common workloads.

```http
PUT https://lasso.sh/api/v1/profiles/prod-base?dry_run=true
Authorization: Bearer <management token>
Content-Type: application/json

{"chains":{"base":{"providers":[
  {"name":"primary","url":"<provider URL>"},
  {"name":"backup","url":"<provider URL>"}],
  "block_protection":true}}}
```

Start with the provider URLs and omit `limits` unless you know a provider
policy to enforce; Lasso learns historical depth, refused methods and log-span
limits from traffic. The dry run checks chain identity only.

1. `?dry_run=true` returns the changes and each provider's chain check without
   storing anything, and needs no Custom access.
2. Holding a profile needs Custom access. Buy days with the same 402 exchange
   as a top-up: `POST /api/v1/accounts/<account_id>/custom-access` with
   `{"days":7}`, at `account_payments.custom_access.day_usd` in `/agent.json`.
   A signed offer keeps its price even if the tariff changes.
3. The same `PUT` without `dry_run` stores it. `provider_check_failed` names a
   wrong provider and nothing changes; a provider that can't answer yet is
   saved as `verifying` and routes once a later check passes.
4. Route the app over it: `<rpc_url>/profile/prod-base/<strategy>/<chain>`,
   or `PATCH` the key's `default_profile` to `prod-base`.
5. `GET /api/v1/profiles/prod-base` shows the revision, each provider's status
   and what Lasso has learned (`effect: on` changes routing; `shadow` is
   observed only). Provider URLs and header values are never returned.

Omitting a provider removes it; omitting a provider's `url` keeps the stored
one. `Accept: application/yaml` exports the profile for self-hosted Lasso RPC
Core. `DELETE` removes it; URLs naming it then serve as `premium`. When Custom
access lapses, the profile is kept and its URLs serve from `premium`, charged
at request prices, until renewed.

## What stays with the app

Replay-safe reads fail over within one deadline and a bounded number of
upstream dispatches. A signed transaction is sent to one provider and is not
retried after dispatch. A timeout or lost response leaves its outcome unknown:
look up the transaction hash before resending or replacing it. The app owns
signing, nonces, replacement, receipts and finality. HTTP filter IDs are
provider-local, so use `eth_getLogs` or subscriptions. Historical depth and
`eth_getLogs` range caps vary by provider, so keep range splitting in
indexers.

Limits: 10 unauthenticated account creations per hour per IP; 100 active keys
and 5 Custom profiles per account. Rate limits are shared by all of an
account's keys. One managed bucket holds premium and public traffic: 100 RPS
with bursts to 200 while the account has premium access, or 30 RPS with bursts
to 60 while payment fallback or free access serves it. Public traffic also
draws on a public bucket (30 RPS, bursts to 60), and each Custom profile has
its own (1,000 RPS). `RateLimit-Policy`
names the bucket that bound the request.

## Troubleshooting

Every error Lasso originates carries `code` and `next_action`; follow it.

| Code | Fix |
|---|---|
| 402 `balance_exhausted` | Credit the account (`next_action` names the URL) or subscribe |
| 403 `forbidden` on RPC | The key is scoped; use a profile `next_action` lists |
| 404 `unknown_profile` | Use a profile `next_action` lists |
| 401 `key_revoked` | The key was revoked or rotated past its overlap; use the current key |
| 422 `rpc_route_required` | Add `/<chain>` or `/<strategy>/<chain>` to the URL |
| 422 `unknown_chain`, `unknown_strategy` | Use a value from `/agent.json` (`ethereum`, not `mainnet`) |
| 504 `deadline_exhausted`, or `-32005` `log_range_too_large` | Narrow the `eth_getLogs` block range |
| `custom_access_required` | Buy Custom access or have the owner subscribe |
| `payment_conflict`, `payment_pending` or payment 202 | Read `GET /api/v1/purchases/<id>` using the returned purchase ID; never pay again |
| Rotation 202 with `serving_ready: false` | Honor `Retry-After`; retain valid grace authority and retry replacement RPC, not rotation |
| 429 `rate_limited` | Honor `Retry-After` |
| 503 `unavailable` | Check disabled capabilities in `/agent.json`; for temporary refusal honor `Retry-After`, retry the same operation and retain its original payment identity. Never pay twice. |

## Report a problem

If something in Lasso is confusing, broken or slows you down, tell us. No
credential is needed; quote a request ID or `operationId` when you have one:

```http
POST https://lasso.sh/api/v1/feedback
Content-Type: application/json

{"message":"<what happened>","category":"api","request_id":"<x-lasso-request-id>"}
```

`category` is `docs`, `api`, `payment`, `routing`, `rpc`, `dashboard` or
`other`. Lasso redacts anything shaped like a secret before storing it; still,
never include one.

## Agent API v2 compatibility

v2 RPC URLs keep working, and v2 request signals and RPC `error_type` stay
alongside `error.data.code`; follow `error.data.next_action`. The Agent API v2
management routes answer gone (HTTP 410) with a `next_action` naming the
`/api/v1` operation, where the same management token works.

## Links

- Product docs: https://docs.lasso.sh
- Public dashboard: https://lasso.sh/dashboard/public
- Open-source routing core (Apache-2.0): https://github.com/jaxernst/lasso-rpc

Lasso Cloud is the managed service on lasso.sh; the routing core is open source.
