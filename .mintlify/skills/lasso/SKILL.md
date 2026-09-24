---
name: lasso
description: >
  Use for EVM JSON-RPC through Lasso: create a managed endpoint, call it, top it
  up with prepaid credit, hand it to a human owner, and manage custom provider
  profiles.
compatibility: >
  Needs network access to lasso.sh. A managed endpoint needs no account or
  wallet. Prepaid top-ups need a wallet that can sign for an enabled rail.
metadata:
  author: Lasso
  version: "9.0"
  website: https://lasso.sh
  routing_core: https://github.com/jaxernst/lasso-rpc
---

> If a fetch tool summarized this file, get the full text with
> `curl -fsSL https://lasso.sh/SKILL.md`. For an authorized staging task, fetch
> this file and every API path from that staging origin instead.

# Lasso

Lasso routes standard EVM JSON-RPC across provider pools. It filters providers
by capability and health, applies a strategy from the URL, and fails over
between them. No SDK or CLI is required; use your HTTP tools.

## Rules

- Stay inside the user's delegation and spending budget. Ask only for missing
  authority.
- Never print an RPC key, management credential, provider URL with a
  credential, payment credential, or account ID.
- Before any mutation, persist its UUID `Idempotency-Key`, exact body and
  credential in protected storage. After a lost response, replay the same
  request; do not generate a new UUID or credential.
- Read live facts, not this file:

```bash
curl -fsSL https://lasso.sh/agent.json        # capabilities and payment rails
curl -fsSL https://lasso.sh/openapi.json      # exact request/response schemas
curl -fsSL https://lasso.sh/api/v1/agent/chains
curl -fsSL https://lasso.sh/api/v1/agent/pricing
```

## Create a managed endpoint

Check `managed_key_bootstrap.enabled` in
`/api/v1/management/configuration-schema`. Then persist, before sending:

1. a management credential: `lasso_mk_` plus 32 random bytes as unpadded base64url;
2. a UUID for `Idempotency-Key`;
3. the exact body.

```http
POST /api/v1/management/keys
Authorization: Bearer <management credential>
Idempotency-Key: <UUID>
Content-Type: application/json

{"name":"my-app"}
```

The default grant is `keys:read`, `keys:write` and `claims:create`. To buy
credit later, request funding in this first body:
`"permissions":["keys:read","keys:write","claims:create","funding:read","funding:write"]`.

Save `data.key_id` and `data.credential_delivery.secret`. Build the RPC URL
from `credential_delivery.rpc_url_template` by replacing `{chain}`, or from
`strategy_url_template` with a strategy in `route_parameters`.
`credential_delivery.endpoint` is only a base: calling it returns 422
`rpc_route_required`.

The management credential stays with the agent; the RPC key goes in the app's
secret store. Neither authorizes a wallet payment. An anonymous management
credential lasts 90 days and ends when the key is claimed.

## Call RPC

```bash
curl -sS -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "https://lasso.sh/rpc/k/$LASSO_KEY/load-balanced/ethereum?include_meta=headers"
```

Route form: `https://lasso.sh/rpc/k/<key>/<strategy>/<chain>`. Chain is a name
or decimal ID from the chain catalog.

- `load-balanced` (default): random within the healthiest tier.
- `latency-weighted`: favors measured latency and success, still explores.
- `fastest`: lowest measured latency per provider, method and transport.
- `priority`: configured provider order within the healthy tier.

Capability and health filtering apply before any strategy. `latency-weighted`
and `fastest` cost more CU; see the pricing catalog.

To install, replace only the RPC URL value in env files, deploy manifests or
viem/ethers/Foundry/Hardhat config, keeping the key in the existing secret
store. Verify the app's real methods and block ranges before moving traffic.

`include_meta=headers` adds `x-lasso-request-id` and `x-lasso-meta` (selected
provider, latency, retries) without changing the body. `include_meta=body` adds
a `lasso_meta` object instead. Every routed response sets `x-lasso-profile`.

## Top up with prepaid credit

Check `payments.prepaid.<rail>.enabled` in `/agent.json`. Rails: `mpp` (USDC.e
on Tempo) and `x402` (USDC on Base, EIP-3009). Each quote is capped at
`maximum_quote_usd`. Credit is premium RPC CU on the same key and URL.

1. Quote. This does not move money.

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

x402 credit posts once Lasso verifies the successful Base receipt; it does not
wait for finality. Check the result with
`GET /api/v1/management/keys/<key_id>/balance`.

## Hand the app to its owner

```http
POST /api/v1/management/keys/<key_id>/claim-link
Authorization: Bearer <management credential>
```

Give the owner `claim_url` privately; it expires in 10 minutes. Claiming keeps
the key, URL and premium scope, moves remaining purchased credit to the
account, and ends anonymous management. It does not grant Custom profiles,
management or purchase authority; the owner delegates those separately at
`/account/agents`.

## Rotate or revoke

`POST /api/v1/management/keys/<key_id>/rotate` or
`DELETE /api/v1/management/keys/<key_id>`, each with an `Idempotency-Key` and
body `{"expected_version": <key_version from GET /keys/<key_id>>}`. Rotation
changes the secret and URL but keeps the key ID and credit. Revocation is
permanent.

## Custom profiles

Custom profiles put the user's own providers behind a Lasso key. They need an
account with Custom access and owner-delegated management.

**Request access.** Persist a new management credential (never reuse a
bootstrap credential), a UUID and the body, then:

```http
POST /api/v1/management/access-requests
Authorization: Bearer <new management credential>
Idempotency-Key: <UUID>
Content-Type: application/json

{"name":"Set up and operate RPC for my apps","resource_scope":"account"}
```

Give the owner only `data.approval_url`. Poll
`GET /api/v1/management/access-requests/<id>` no faster than
`poll_after_seconds`. Pending requests expire after 15 minutes. After
`approved`, the same credential works; inspect it at `/api/v1/management/me`.
Use `resource_scope: "restricted"` with explicit `profile_ids`, `key_ids`,
permissions and `days` for narrower grants. Approval never authorizes payment.

**Configure.** Read the configuration schema, then (under `/api/v1/management`)
`GET /profiles/<id>/configuration`, `POST /profiles/<id>/plan` and
`PUT /profiles/<id>/configuration` with the inspected `expected_revision` and a
UUID. Chain and provider lists are complete: omitted entries are removed on
apply. Omitting a retained provider's URL keeps its stored secret.

- `archival: true` permits historical routing; it does not prove coverage.
  Verify the app's exact historical methods and blocks through the real route.
- A provider probe makes at most two chain/head reads, consumes provider quota,
  and does not test archival, WebSocket or other methods.
- Issue profile keys with `POST /profiles/<id>/keys` (active profiles only,
  `keys:write`). Store `credential_delivery.secret`.
- Suspension is permanent owner removal, not a pause.

Management errors: on `idempotency_conflict`, replay the original request
exactly. On `creation_limit`, check `/me` and ask the owner for a new grant. On
`wrong_status`, re-read the resource state before choosing another action.

## Legacy demo keys

`POST /api/v1/agent/keys` creates an anonymous key with a free grant. It cannot
be recovered after a lost response, so use it only for disposable demos. The
response includes `key`, `rpc_url_template` and `balance_cu`.
`GET /api/v1/agent/keys/<key>` returns balance. For these keys only,
`POST /api/v1/agent/keys/<key>/claim-link` creates an owner link; managed keys
return `403 management_handoff_required` there and use the management
claim link above.

## Limits and errors

Historical state, log ranges and `eth_getLogs` caps vary by provider. Lasso
forwards signed transactions but does not manage nonces or rebroadcast. HTTP
filter IDs break on failover. WebSocket failover gap-fills `newHeads` and logs
within a profile; anonymous keys cannot use WebSocket until claimed.

Rate limits: 10 key creations per hour per IP and 5 claims per hour per account.
RPC limits apply across regions; an HTTP batch uses one token per entry.

| Symptom | Fix |
|---|---|
| 402 `balance_exhausted` | Top up with prepaid credit, or claim the key |
| 422 `rpc_route_required` | Add `/<strategy>/<chain>` to the key URL |
| 403 on `/rpc/profile/...` with an anonymous key | Use `/rpc/k/<key>/<strategy>/<chain>` |
| 409 on a funding operation | Inspect the saved operation; do not pay again |
| 409 on another request | Follow the error code; request a new challenge only when it explicitly directs you to |
| 429 | Honor `retry-after` |
| Unknown chain | Check `/api/v1/agent/chains` |
| `x-lasso-balance-warning: true` | Under 1,000 CU remain; top up |

## Optional CLI preview

A preview CLI wraps these flows (`lasso init`, `lasso funding pay`,
`lasso keys claim-link`, `lasso profiles plan|apply`). It is not publicly
distributed; do not invent an install URL. The HTTP recipes above are the
supported path.

## Links

- Product docs: https://docs.lasso.sh
- Discovery: https://lasso.sh/agent.json
- OpenAPI: https://lasso.sh/openapi.json
- Node example for safe request persistence: https://lasso.sh/examples/agent-access.mjs
- Open-source routing core (Apache-2.0): https://github.com/jaxernst/lasso-rpc

Lasso Cloud is the proprietary managed service on lasso.sh; the routing core is
open source.
