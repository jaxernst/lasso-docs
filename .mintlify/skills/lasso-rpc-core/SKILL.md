---
name: lasso-rpc-core
description: >
  Use when self-hosting Lasso RPC Core, the open-source EVM JSON-RPC proxy:
  install it, configure provider profiles in YAML, choose routing strategies,
  and inspect routing decisions.
compatibility: >
  Needs Docker Compose and OpenSSL for the container install, or Elixir 1.18
  and Erlang/OTP 28 for source builds. For a hosted endpoint, use the `lasso`
  skill instead.
metadata:
  author: Lasso
  version: "1.0"
  source: https://github.com/jaxernst/lasso-rpc
---

# Lasso RPC Core

Lasso RPC Core is an Apache-2.0 Elixir/Phoenix proxy that routes standard EVM
JSON-RPC across a pool of upstream providers, with health tiers, circuit
breakers, bounded retries and WebSocket failover. Applications change only
their RPC URL.

## Install

```bash
mkdir lasso && cd lasso
curl --fail --location https://github.com/jaxernst/lasso-rpc/releases/latest/download/compose.yml --output compose.yml
(umask 077; printf 'SECRET_KEY_BASE=%s\nRELEASE_COOKIE=%s\n' "$(openssl rand -hex 64)" "$(openssl rand -hex 32)" > .env)
docker compose up -d --wait
curl --fail http://localhost:4000/api/health
curl --fail http://localhost:4000/rpc/ethereum -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Keep `.env` private and preserved; it holds the signing and Erlang cookie
secrets. The named `/data` volume keeps profiles and benchmark history. Health
only proves the process runs; `eth_blockNumber` proves an upstream answered
(`eth_chainId` can be answered locally).

The dashboard is at `http://localhost:4000/dashboard`. Core has no client
authentication or inbound rate limits: put RPC, metrics and dashboard
endpoints behind your own network controls or reverse proxy.

## Route requests

| Route | Behavior |
|---|---|
| `POST /rpc/<chain>` | Default strategy (load-balanced) |
| `POST /rpc/<strategy>/<chain>` | `fastest`, `load-balanced` or `latency-weighted` |
| `POST /rpc/provider/<provider_id>/<chain>` | Pin one provider |
| `POST /rpc/profile/<profile>/...` | Any route above within a named profile |
| `/ws/rpc/...` | WebSocket forms of the same routes |

Routes without a profile use `public`. Add `include_meta=headers` (or
`include_meta=body`) to see the selected provider, latency and retries.

## Configure providers

Profiles are YAML files in `config/profiles/` (`public.yml` ships free public
providers). Each chain lists providers with `id`, `url`, optional `ws_url`,
`priority` and `archival`. Put provider keys in `.env` and reference them in
URLs as `${VAR_NAME}`; unresolved variables fail at startup. Recreate the
container after changing `.env`.

`archival: true` permits historical routing; it does not prove the provider
serves historical state. Qualify historical `eth_call`/`eth_getBalance` at your
real block depths before relying on it. Requests pinned by EIP-1898 block hash
require an archival provider.

## Limits

History depth, log ranges and method support depend on your upstreams. Lasso
forwards signed transactions once and does not manage nonces or rebroadcast.
HTTP filter IDs are provider-local. WebSocket failover backfills `newHeads` and
logs within bounds.

## Links

- Installation: https://docs.lasso.sh/installation
- Configuration: https://docs.lasso.sh/configuration/overview
- Releases and evidence: https://docs.lasso.sh/releases-and-availability
- Source: https://github.com/jaxernst/lasso-rpc
