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
  version: "10.0"
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
- Never print an RPC key, management credential, provider URL with a
  credential, payment credential or account ID. Create responses repeat the
  RPC secret in several fields; never print them raw.
- Before any mutation, persist its `Idempotency-Key` UUID, exact body and
  credential in protected storage. After a lost response, replay the same
  request; a new UUID or credential starts new work.
- Live documents outrank this file:

```bash
curl -fsSL https://lasso.sh/agent.json        # capabilities and payment rails
curl -fsSL https://lasso.sh/openapi.json      # exact request/response schemas
curl -fsSL https://lasso.sh/api/v1/agent/chains
curl -fsSL https://lasso.sh/api/v1/agent/pricing
```

## Create an endpoint

Confirm `managed_key_bootstrap.enabled` in
`/api/v1/management/configuration-schema`. You generate the management
credential (`lasso_mk_` plus 32 random bytes, unpadded base64url) and a UUID,
and persist both with the exact body before sending. Rerun this snippet after
a lost response. It reuses saved state; use a fresh state directory for a new
key:

```bash
set -euo pipefail
umask 077
S="${XDG_STATE_HOME:-$HOME/.local/state}/lasso"
mkdir -p "$S"
if [ ! -e "$S/bootstrap" ]; then
  credential="lasso_mk_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  request_id="$(uuidgen)"
  ( set -C; printf '%s\n%s\n' "$credential" "$request_id" > "$S/bootstrap" )
fi
if [ "$(wc -l < "$S/bootstrap")" -ne 2 ]; then
  printf 'Invalid saved bootstrap state; stop before creating a key.\n' >&2
  exit 1
fi
if [ ! -e "$S/key-request.json" ]; then
  ( set -C; printf '%s\n' '{"name":"my-app"}' > "$S/key-request.json" )
fi
jq -e '.name == "my-app"' "$S/key-request.json" > /dev/null
if [ ! -e "$S/key.json" ]; then
  tmp=$(mktemp "$S/key.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  curl -fsS https://lasso.sh/api/v1/management/keys \
    -H "Authorization: Bearer $(sed -n 1p "$S/bootstrap")" \
    -H "Idempotency-Key: $(sed -n 2p "$S/bootstrap")" \
    -H 'content-type: application/json' --data-binary @"$S/key-request.json" > "$tmp"
  jq -er '.data.credential_delivery.strategy_url_template | strings | select(length > 0)' "$tmp" > /dev/null
  mv -n "$tmp" "$S/key.json"
fi
```

Keep this state outside the repository. After a lost response, rerun with the
same credential, idempotency key and body. The create API returns the same key
with `replayed: true`.

The default grant is `keys:read`, `keys:write` and `claims:create`. To buy
credit later, send
`{"name":"my-app","permissions":["keys:read","keys:write","claims:create","funding:read","funding:write"]}`.

Keep `data.key_id` and `data.credential_delivery`. Build URLs from
`rpc_url_template` (replace `{chain}`) or `strategy_url_template` (replace
`{strategy}` and `{chain}`). The RPC key belongs in the app's secret store; the
management credential stays with the agent and lasts 90 days or until the key
is claimed. Neither authorizes a wallet payment.

## Call it and read the evidence

```bash
URL=$(jq -er '.data.credential_delivery.strategy_url_template | strings | select(length > 0)' "$S/key.json" \
  | sed 's/{strategy}/fastest/; s/{chain}/base/')
curl -fsS "$URL?include_meta=body" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq
```

Routes are `https://lasso.sh/rpc/k/<key>/<strategy>/<chain>`; chain is a name
or decimal ID from the catalog.

- `include_meta=body` adds `lasso_meta`: candidates, `selected_provider`,
  retries, and selection, upstream and overhead latency.
- `include_meta=headers` leaves the body unchanged and adds
  `x-lasso-request-id` and `x-lasso-meta` (unpadded base64url JSON).
- Every routed response sets `x-lasso-profile`; agent keys also get
  `x-lasso-cu` and `x-lasso-usd`.
- `eth_chainId` can be answered without an upstream; use `eth_blockNumber` to
  show routing.

Report the result, serving provider, latency and request ID.

## Choose a strategy

Capability and health filtering run first; the strategy orders what remains.
One key can use a different strategy per call site.

| Strategy | Behavior | Use for | Cost |
|---|---|---|---|
| `load-balanced` (default) | Random within the healthiest tier | Background reads, indexers | 1x |
| `latency-weighted` | Favors recent latency and success, keeps exploring | General user traffic | 1.5x |
| `fastest` | Lowest recent latency per provider, method and transport; concentrates traffic | Latency-critical paths | 2x |
| `priority` | Configured order within the healthy tier | Custom profiles with a preferred primary | 1x |

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
(USDC on Base, EIP-3009) and `mpp` (USDC.e on Tempo), each capped at
`maximum_quote_usd` per quote. Credit lands on the same key and URL.

1. Quote. No money moves.

   ```http
   POST /api/v1/management/keys/<key_id>/funding-operations
   Authorization: Bearer <management credential>
   Idempotency-Key: <UUID>
   Content-Type: application/json

   {"rail":"x402","amount_usd":"1","max_usd":"1","payer":"<wallet address>"}
   ```

   Save `data.id`. Check network, asset, recipient, payer, amount and credited
   CU against the user's budget.
2. `POST /api/v1/management/funding-operations/<id>/pay` returns 402 with the
   payment challenge. Have an authorized wallet sign it, then repeat `/pay`
   with the signed credential:

   | Rail | Management auth | Wallet credential |
   |---|---|---|
   | `x402` | `Authorization: Bearer ...` | `PAYMENT-SIGNATURE` |
   | `mpp` | `X-Lasso-Management-Key` | `Authorization: Payment ...` |

   Never send Bearer and `X-Lasso-Management-Key` together.
3. `200` with `state=credited` is the durable receipt. `202` means the transfer
   is unresolved: honor `Retry-After`, then
   `POST /api/v1/management/funding-operations/<id>/reconcile` on the same ID.
   The machine-readable `pending` object names the stage and transaction
   reference. Never sign or submit a second payment while one is pending.

Check credit with `GET /api/v1/management/keys/<key_id>`.

## Hand the app to its owner

```http
POST /api/v1/management/keys/<key_id>/claim-link
Authorization: Bearer <management credential>
```

Give the owner `claim_url` privately; it expires in 10 minutes. Claiming keeps
the key, URL and premium scope, moves purchased credit to the account, and ends
anonymous management. The owner delegates Custom profiles, management and
purchases separately at `/account/agents`.

## Rotate or revoke

`POST /api/v1/management/keys/<key_id>/rotate` or
`DELETE /api/v1/management/keys/<key_id>`, each with an `Idempotency-Key` and
`{"expected_version": "<version from GET /keys/<key_id>>"}`. Rotation changes
the secret and URL but keeps the key ID and credit. Revocation is permanent.

## Custom profiles

A Custom profile routes over the user's own nodes and provider accounts, on any
EVM chain Lasso can probe. It needs a Custom plan account and owner-approved
management.

**Request access** with a new management credential (never the bootstrap one)
and a persisted UUID:

```http
POST /api/v1/management/access-requests
Authorization: Bearer <new management credential>
Idempotency-Key: <UUID>
Content-Type: application/json

{"name":"Set up and operate RPC for my apps","resource_scope":"account"}
```

Give the owner only `data.approval_url`, then poll
`GET /api/v1/management/access-requests/<id>` no faster than
`poll_after_seconds`; requests expire after 15 minutes. Once `approved`, the
same credential works; inspect it at `/api/v1/management/me`. For narrower
grants use `resource_scope: "restricted"` with `profile_ids`, `key_ids`,
permissions and `days`.

**Build a profile** under `/api/v1/management`, one persisted UUID per
mutation:

1. `POST /profiles` with a `slug` creates a draft.
2. Read the configuration schema and `GET /profiles/<id>/configuration`.
3. `POST /profiles/<id>/plan` previews a change against `expected_revision`.
4. `PUT /profiles/<id>/configuration` applies it. Chain and provider lists are
   complete, so omitted entries are removed; omitting a retained provider's URL
   keeps its stored secret.
5. `POST /profiles/<id>/activate` with `expected_revision` makes it live.
6. `POST /profiles/<id>/keys` (`keys:write`) issues a bound key. Store
   `credential_delivery.secret`.

A provider probe makes at most two chain and head reads and uses provider
quota; it does not test archival, WebSocket or other methods. `archival: true`
allows historical routing but does not prove coverage, so test the app's
historical calls through the real route. Suspension is permanent, not a pause.

On `idempotency_conflict`, replay the original request exactly. On
`creation_limit`, ask the owner for a new grant. On `wrong_status`, re-read the
resource before acting.

## What stays with the app

Replay-safe reads fail over within one deadline and at most three upstream
dispatches. Signed transactions go to one provider and are not retried after
dispatch; the app owns nonces, rebroadcast and receipts. HTTP filter IDs are
provider-local, so use `eth_getLogs` or subscriptions. Historical depth and
`eth_getLogs` range caps vary by provider, so keep range splitting in indexers.

Limits: 10 key creations per hour per IP and 5 claims per hour per account. An
HTTP batch uses one rate-limit token per entry; see `x-lasso-rate-limit-*`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| 402 `balance_exhausted` | Top up, or claim the key |
| `x-lasso-balance-warning: true` | Under 1,000 CU left; top up |
| 422 `rpc_route_required` | Add `/<strategy>/<chain>` to the key URL |
| 404 on an RPC URL | POST, with a strategy from `route_parameters` |
| `-32602` unsupported chain | Use a name or ID from `/api/v1/agent/chains` (`ethereum`, not `mainnet`) |
| `deadline_exhausted` on `eth_getLogs` | Narrow the block range |
| 403 `forbidden` on management | Missing permission; check `/api/v1/management/me` |
| 403 `management_handoff_required` | Use `/api/v1/management/keys/<id>/claim-link` |
| 409 on a funding operation | Inspect the saved operation; do not pay again |
| 409 on another request | Follow the error code; request a new challenge only when it explicitly directs you to |
| 429 | Honor `retry-after` |

## Links

- Product docs: https://docs.lasso.sh
- Public dashboard: https://lasso.sh/dashboard/public
- Node example for safe request persistence: https://lasso.sh/examples/agent-access.mjs
- Open-source routing core (Apache-2.0): https://github.com/jaxernst/lasso-rpc

Lasso Cloud is the proprietary managed service on lasso.sh; the routing core is
open source.
