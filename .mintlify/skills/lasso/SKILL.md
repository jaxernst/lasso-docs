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
  version: "12.0"
  website: https://lasso.sh
  routing_core: https://github.com/jaxernst/lasso-rpc
---

> If a fetch tool summarized this file, get the full text with
> `curl -fsSL https://lasso.sh/SKILL.md`.

# Lasso

Lasso gives an app one standard JSON-RPC URL that routes each request across a
provider pool by measured latency and health, with failover and per-request
evidence. This skill covers creating, installing, funding, handing off and
customizing that endpoint over plain HTTP.

## Rules

- Stay inside the user's delegation and spending budget. Ask only for missing
  authority.
- Never print an RPC key, management token, provider URL with a credential,
  payment credential or account ID. The create response repeats the RPC secret
  in `key` and `rpc_url`; never print them raw.
- Key and profile requests need no idempotency ceremony: a profile `PUT` is
  the whole desired state, so repeating it after a lost response is safe.
- Live documents outrank this file:

```bash
curl -fsSL https://lasso.sh/agent.json    # chains, strategies, prices, payment rails
curl -fsSL https://lasso.sh/openapi.json  # exact request/response schemas
```

## Create an endpoint

Check `auth.keys.creation_enabled` in `/agent.json`; when it is false, key
creation and changes answer 503 `unavailable`. Then it is one request, with no
credentials:

```bash
set -euo pipefail
umask 077
S="${XDG_STATE_HOME:-$HOME/.local/state}/lasso"
mkdir -p "$S"
curl -fsS https://lasso.sh/api/v1/management/keys \
  -H 'content-type: application/json' -d '{"name":"my-app"}' > "$S/key.json"
```

The response is `{id, key, rpc_url, management_token, balance_usd}`. Put `key`
(or `rpc_url`) in the app's secret store; keep `management_token` with the
agent, outside the repository. The token manages every key it creates and lasts
until the owner claims them; it never authorizes a wallet payment. A lost
response leaves an unused free key, so create another.

## Call it and read the evidence

Append a chain to `rpc_url`, optionally with a strategy before it:
`<rpc_url>/base` uses the default strategy, `<rpc_url>/fastest/base` picks one.

```bash
URL="$(jq -er .rpc_url "$S/key.json")/fastest/base"
curl -fsS "$URL?include_meta=body" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq
```

The chain is a name or decimal ID from the catalog.

- `include_meta=body` adds `lasso_meta`: candidates, `selected_provider`,
  retries, and selection, upstream and overhead latency.
- `include_meta=headers` leaves the body unchanged and adds `x-lasso-meta`
  (unpadded base64url JSON with the same fields).
- Every RPC response carries `x-lasso-request-id`; quote it when reporting a
  problem.
- Every routed response sets `x-lasso-profile`; agent keys also get
  `x-lasso-usd` (this request's charge) and `x-lasso-balance-usd`.
- `eth_chainId` can be answered without an upstream; use `eth_blockNumber` to
  show routing.

Report the result, serving provider, latency and request ID. For balance and
the last 24 hours of usage, `GET /api/v1/management/keys/<id>` with the
management token as Bearer, or `GET /api/v1/management/keys/current` with the
RPC key as Bearer. The response's `recent_errors` groups failures by code,
category and last reached provider, with counts and `next_action` guidance.

## Choose a strategy

Capability and health filtering run first; the strategy orders what remains.
One key can use a different strategy per call site.

| Strategy | Behavior | Use for | Cost |
|---|---|---|---|
| `load-balanced` (default) | Random within the healthiest tier | Background reads, indexers | 1x |
| `latency-weighted` | Favors recent latency and success, keeps exploring | General user traffic | 1.5x |
| `fastest` | Lowest recent latency per provider, method and transport; concentrates traffic | Latency-critical paths | 2x |
| `priority` | Configured order within the healthy tier | Custom profiles with a preferred primary | 1x |

For anonymous prepaid keys, these are nominal CU factors; integer CU charges
round down per method. `agent.json` lists their exact method and strategy USD
prices. Claimed account keys use account CU metering, so use the account's plan
and usage rather than this table to assess their cost.

## Install into the app

Replace only the RPC URL value in env files, deploy manifests, viem or ethers
clients, Foundry or Hardhat config and indexer settings, and keep the key in
the existing secret store.

```ts
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) })
```

Run the app's real methods and block ranges through the new URL before moving
traffic. WebSocket (`wss://lasso.sh/ws/rpc/<strategy>/<chain>`) needs an
account key, so claim the key first.

## Top up with prepaid credit

Check `payments.prepaid.<rail>.enabled` in `/agent.json`. Rails are `x402`
(USDC on Base, EIP-3009) and `mpp` (USDC.e on Tempo), each allowing
`minimum_usd` to `maximum_usd` per purchase. Credit lands on the same key and
URL. No Lasso credential is needed, and anyone may pay for any key.

```http
POST /api/v1/management/keys/<key_id>/credit
Content-Type: application/json

{"usd":"1"}
```

1. The first request answers 402 with an x402 challenge in `PAYMENT-REQUIRED`
   and an MPP charge challenge in `WWW-Authenticate`. Check the amount against
   the user's budget.
2. Have an authorized wallet sign one challenge with a standard x402 or MPP
   client, then repeat the same request and body with `PAYMENT-SIGNATURE`
   (x402) or `Authorization: Payment` (MPP). Stock clients such as
   `@x402/fetch` and `mppx` do both steps.
3. `200` returns `credited_usd`, `balance_usd` and a receipt. `202` means the
   transfer is still settling: Lasso finishes it in the background, and
   `status_url` reports progress. Never sign a second payment while one is
   pending; resubmitting the same signed payment returns its result and never
   credits twice.

Custom access is bought the same way with
`POST /api/v1/management/keys/<key_id>/custom-access` and `{"days":7}` at the
per-day price in `payments.prepaid.custom_access`. It belongs to an account, so
the key must be claimed first.

## Hand the app to its owner

```http
POST /api/v1/management/keys/<key_id>/claim-link
Authorization: Bearer <management token>
```

Holding only the RPC key works too: use `current` as the ID and the RPC key as
Bearer. Give the owner `claim_url` privately before `expires_at` (10 minutes).
Claiming moves every key created by the same management token into the account
with its remaining credit, keeps every URL working, and ends the token. The
owner delegates Custom profiles, management and purchases separately at
`/account/agents`.

## Rotate or revoke

`POST /api/v1/management/keys/<key_id>/rotate` returns a new `key` and
`rpc_url` and stops the old secret; update every deployment that uses it.
`DELETE /api/v1/management/keys/<key_id>` revokes the key; repeating it
succeeds. Both keep the key ID; rename or rebind with `PATCH` and
`{"name":..., "profile":...}`.

## Custom profiles

A Custom profile routes over the user's own nodes and provider accounts, on any
EVM chain Lasso can probe. Profiles belong to an account, so connect to the
user's account first:

```http
POST /api/v1/management/connections
Content-Type: application/json

{"name":"Set up RPC for my app"}
```

Store `token` in the user's secret store and give the owner only
`approval_url`. Poll `GET /api/v1/management/connections/<id>` with
`Authorization: Bearer <token>` no faster than every five seconds; the owner has
15 minutes. Once `approved`, the same token manages the account's keys and
profiles; `GET /api/v1/management/me` shows what it covers. It never
authorizes payment.

**Build a profile** with one document: the chains, each with its providers in
preference order. Check `GET /api/v1/management/configuration-schema` for
every optional field and recipes for common workloads.

```http
PUT /api/v1/management/profiles/my-app?dry_run=true
Authorization: Bearer <management token>
Content-Type: application/json

{"chains":{"base":{"providers":[
  {"name":"primary","url":"<provider URL>"},
  {"name":"backup","url":"<provider URL>"}],
  "block_protection":true}}}
```

Profile documents are available when `auth.profiles.documents_enabled` is true
in `/agent.json`.

1. `?dry_run=true` returns the changes and each provider's chain check without
   storing anything, and needs no Custom access.
2. The same `PUT` without `dry_run` stores it. Lasso checks every new or
   changed provider answers for its chain: `provider_check_failed` names a
   wrong one and nothing changes. A provider that cannot answer yet is saved as
   `verifying` and routes once a later check passes.
3. `GET /profiles/my-app` shows the revision, each provider's status and what
   Lasso has learned about it; provider URLs are never returned. Send
   `If-Match: <revision>` on the next `PUT` to refuse a concurrent change.
   Omitting a provider removes it; omitting its `url` keeps the stored one.
4. When `auth.keys.profile_binding_enabled` is true in `/agent.json`,
   `POST /api/v1/management/keys` with `{"profile":"my-app"}` issues a bound
   key, or `PATCH` an existing key's `profile`. Store `key` in the app's
   secret store.

`GET /profiles/my-app` with `Accept: application/yaml` exports the profile for
self-hosted Lasso RPC Core, provider URLs replaced by environment variables.
`DELETE /profiles/my-app` removes it; bound keys stop routing until rebound.
Applying a profile needs Custom access: buy days with
`POST /api/v1/management/keys/<key_id>/custom-access` for a claimed key, or have
the owner subscribe.

## What stays with the app

Replay-safe reads fail over within one deadline and at most three upstream
dispatches. Identical signed transaction bytes identify the same transaction;
an RPC response is not proof of propagation, receipt, or finality. The app
owns signing, nonces, replacement, receipts, and finality. HTTP filter IDs are
provider-local, so use `eth_getLogs` or subscriptions. Historical depth and
`eth_getLogs` range caps vary by provider, so keep range splitting in indexers.

Limits: 10 key creations per hour per IP and 5 claims per hour per account. An
HTTP batch uses one rate-limit token per entry; see `x-lasso-rate-limit-*`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| 402 `balance_exhausted` | Credit the key (`error.data.next_action` names the URL), or claim it |
| `x-lasso-balance-warning: true` | Under $0.005 left; top up |
| 422 `rpc_route_required` | Add `/<strategy>/<chain>` to the key URL |
| 404 on an RPC URL | POST to `<rpc_url>/<chain>` or `<rpc_url>/<strategy>/<chain>` |
| `-32602` unsupported chain | Use a name or ID from `chains` in `/agent.json` (`ethereum`, not `mainnet`) |
| `deadline_exhausted` on `eth_getLogs` | Narrow the block range |
| 403 `forbidden` on management | Missing permission; check `/api/v1/management/me` |
| 409 `payment_conflict` or 202 on a purchase | Check `status_url`; do not pay again |
| 409 on another request | Follow the error code; request a new challenge only when it explicitly directs you to |
| 429 | Honor `retry-after` |

## Links

- Product docs: https://docs.lasso.sh
- Public dashboard: https://lasso.sh/dashboard/public
- Open-source routing core (Apache-2.0): https://github.com/jaxernst/lasso-rpc

Lasso Cloud is the managed service on lasso.sh; the routing core is open source.
