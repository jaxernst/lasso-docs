---
name: lasso
description: >
  Set up, operate and debug EVM JSON-RPC through Lasso (lasso.sh), which an
  agent can provision without signup. Use when an app needs an Ethereum or EVM
  RPC URL; when RPC calls are slow, rate-limited or failing; when configuring
  RPC for viem, ethers, Foundry, Hardhat or an indexer; when WebSocket
  subscriptions drop; or when routing across several providers or the user's
  own nodes; or when consuming ordered contract events with Lasso Streams.
compatibility: >
  Needs HTTPS access to lasso.sh and curl, jq and openssl (or equivalents). No
  account or wallet is needed to start; top-ups need a wallet that can sign
  for an enabled rail.
metadata:
  author: Lasso
  version: "14.4"
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
  second account.
- Live documents outrank this file:

```bash
curl -fsSL https://lasso.sh/agent.json    # chains, strategies, prices, rails, features
curl -fsSL https://lasso.sh/openapi.json  # exact request/response schemas and errors
```

An operation whose flag is off in `features` answers `unavailable`. For HTTP 503 `unavailable`,
follow the response’s `next_action`, honor `Retry-After` and retry the same operation.
Keep the original purchase ID,
signed offer/payment and `status_url`; poll that URL and never pay twice.

## Check readiness

Lasso serves the account model, and the RPC recipes below work as written once
`/agent.json` reports `features.native_serving: true`. Check it before
installing a new endpoint or scoped key:

- **`native_serving: true`:** the answering node accepts account RPC. RPC routes by the URL and enforces `allowed_profiles`,
  and uses the account's access, included usage and balance.
- **`native_serving: false`:** keep the app on its working endpoint. Follow the
  refusal’s `next_action` and `Retry-After` before retrying RPC with the saved key.
- **`native_collection`** always equals `native_serving`: every request served
  natively counts toward the key's diagnostics and the account's charges.
- `features.claim_completion` and `features.connection_approval` confirm the
  browser steps behind claim links and connections. Use their own response to continue
  the operation. For `unavailable`, honor `Retry-After` and retry the same operation.

## Create an endpoint

One request, with no credentials, creates a provisional account, makes you its
agent and issues the first key:

```bash
created="$(curl -fsS https://lasso.sh/api/v1/keys \
  -H 'content-type: application/json' -d '{"name":"prod"}')"
jq '{id, account_id, serving_ready}' <<<"$created"
```

The response is `{id, key, rpc_url, ws_url, account_id, management_token, serving_ready}`;
only its non-secret fields are shown. Move `rpc_url` and `ws_url` from it into
the app's secret store without printing them. The key alone calls,
reads its account and funds it. `management_token` makes you the account's
agent: use it to add keys, rotate them, build Custom profiles and hand the
account over. It never authorizes a wallet payment. The account starts with a
small balance, enough to verify.

HTTP 201 with `serving_ready: true` means the key is ready to use. HTTP 202
with `serving_ready: false` returns the same committed credentials. Save them,
wait the response's `Retry-After`, then call RPC with that key. If RPC is not ready yet, honor `Retry-After` and retry RPC with the saved key.
Do not repeat key creation: the account and key already exist.

Add more keys to the same account, sharing one balance, with the token;
without it, a create makes a separate account:

```bash
staging="$(curl -fsS https://lasso.sh/api/v1/keys \
  -H "authorization: Bearer <management token>" \
  -H 'content-type: application/json' -d '{"name":"staging"}')"
jq '{id, serving_ready}' <<<"$staging"
```

## Call it and read the evidence

The returned `rpc_url` and `ws_url` already end in `/profile/premium` when
premium is allowed. Otherwise they advertise the sole allowed canonical profile,
or the first canonical slug in lexical order. Append only a chain and optionally
a strategy; never append another `/profile/`. With `LASSO_RPC_URL` set to
`rpc_url`:

```bash
URL="$LASSO_RPC_URL/fastest/base"
curl -fsS -D - "$URL?include_meta=body" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

The chain is a name or decimal ID from `chains` in `/agent.json`.

- `include_meta=body` adds `lasso_meta`: strategy used, candidates,
  `selected_provider`, retries, and upstream and overhead latency.
  `include_meta=headers` leaves the body unchanged and adds `x-lasso-meta`.
- Every response carries `x-lasso-request-id`; quote it when reporting a
  problem. Served requests add `x-lasso-access` (`premium`, `public` or
  `custom`), `x-lasso-cu`, `x-lasso-usd` (this request's charge),
  `x-lasso-balance-usd` and standard `RateLimit` headers.
- `x-lasso-fallback` appears when a request was served somewhere other than
  the profile it named: `payment`, `free` or `profile`.
- `eth_chainId` can be answered without an upstream; use `eth_blockNumber` to
  show routing.

WebSocket requests with `lasso_meta: "notify"`
receive the existing metadata frame with `cu`, `usd`, `balance_usd`, `access`
and any `fallback`. CU/USD reflect the selected outcome; balance is the local
post-charge estimate. Delivery never waits for settlement.

Report the result, serving provider, latency and request ID. For diagnostics,
`GET /api/v1/keys/<id>` with your management token, or `GET /api/v1/keys/current`
with the RPC key. `usage` counts the key's requests over the rolling last 24
hours and sums their charges in `charged_usd`; `recent_errors` returns up to 20
groups with `code`, `category`, `provider`, `count`, `last_at` and
`next_action`. A request shows up as soon as its response is sent. Use them to
find what failed and where; the account's balance is the record of money.

## Choose a profile and a strategy

An unrestricted key reaches every profile of its account. The URL picks one:
`<rpc_url>[/<strategy>]/<chain>`. To switch profiles, replace the profile
segment in the returned prefix; do not append another one.

| URL | Served by |
|---|---|
| `<rpc_url>/<strategy>/<chain>` | The explicit profile already in the returned prefix |
| `https://lasso.sh/rpc/k/<key>/profile/public/<chain>` | Public providers, uncharged, `load-balanced` only, while the balance, included usage, grace window or free allowance would serve the account; otherwise `balance_exhausted` |
| `https://lasso.sh/rpc/k/<key>/profile/<slug>/<strategy>/<chain>` | The account's Custom profile |

| Strategy | Behavior | Use for | Price factor |
|---|---|---|---|
| `load-balanced` | Random within the healthiest providers | Backends, indexers | 1x |
| `balanced-fast` (default on Premium) | Spreads traffic, favoring recently fast providers | User-facing reads | 1.5x |
| `fastest` | Lowest recent latency per provider, kind of request and transport; concentrates traffic | Latency-critical paths | 2x |
| `priority` | Configured order within the healthy providers | Custom profiles with a preferred primary | 1x |

Health and known capability steer candidates first, as a preference rather
than a guarantee. Premium and Custom serve all four strategies; `public`,
payment fallback and free access serve `load-balanced`, and
`lasso_meta.strategy` reports what was used. A URL without a strategy uses
`balanced-fast` on Premium and `load-balanced` on Custom profiles.
`latency-weighted` is an alias of `balanced-fast`. `agent.json` lists exact USD
prices per method and strategy.

## Install into the app

Replace only the RPC URL in env files, deploy manifests, viem or ethers
clients, Foundry or Hardhat config and indexer settings:

```ts
const client = createPublicClient({
  chain: base,
  transport: http(`${process.env.LASSO_RPC_URL}/balanced-fast/base`),
})
```

Subscriptions use `${LASSO_WS_URL}/<chain>`. Run the app's real methods and
block ranges through the new URL before moving traffic.

A URL that ships to a browser or mobile app is public. Give it its own key
scoped to `public`, so a copied key can't spend the balance. A key scoped to a
Custom profile isn't safe to expose: when Custom access lapses, it is served
and charged as `premium`.

```json
{"name":"web","allowed_profiles":["public"]}
```

## Fund the account

Check `features.account_purchases` and `account_payments.rails` in
`/agent.json` for configured rails (`x402`: USDC on Base; `mpp`: USDC.e on
Tempo) and the per-purchase range. No Lasso credential is
needed, and anyone may pay for any account. The RPC key reads the account's
`id`:

```bash
curl -fsS https://lasso.sh/api/v1/accounts/current \
  -H "authorization: Bearer <RPC key>" | jq '{id, balance_usd}'
```

```http
POST https://lasso.sh/api/v1/accounts/<id>/credit
Content-Type: application/json

{"usd":"5"}
```

1. The first request answers 402. Its `offer.rails` lists the rails that
   accept this amount, each with a challenge: x402 in `PAYMENT-REQUIRED`, MPP
   in `WWW-Authenticate: Payment`. Check the amount against the user's budget.
2. Have an authorized wallet sign one challenge with a standard client
   (`@x402/fetch`, `mppx`), then repeat the same request with
   `PAYMENT-SIGNATURE` (x402) or `Authorization: Payment` (MPP).
3. `200` returns `credited_usd`, `balance_usd` and a receipt. `202` means
   settlement is pending: poll `status_url`.
   Never sign a second payment while one is pending; resubmitting the same
   signed payment returns its result and never credits twice.

To start with a funded key instead of a free one, send the same exchange to
`POST https://lasso.sh/api/v1/credit` before creating any key. It needs no
`id`: the paid response creates the account and returns its credentials under
`key` (`rpc_url`, `ws_url`, `key`, `management_token`, `account_id`). If the
response is lost, resubmit the same signed payment: it credits once and shows
the same credentials again.

When the money runs out on an account that has paid, RPC requests keep serving on
public providers for 30 days (`x-lasso-fallback: payment`, `x-lasso-usd: 0`),
and `GET /api/v1/accounts/current` shows `fallback.until`. A top-up returning
`200` confirms the credit. Check `x-lasso-access: premium` on subsequent
responses to confirm premium serving has resumed. An account that never paid
gets `balance_exhausted` once its starting balance is spent.

To catch this in an app, watch for `x-lasso-fallback: payment` on responses
and top up before `fallback.until`. After that date, requests answer 402
`balance_exhausted` and open WebSocket connections close.

Accounting never interrupts RPC serving: requests keep their route and price
whether or not charges are being recorded.

Lasso charges only successful results. Every final JSON-RPC error is free,
including execution reverts and provider rate-limit errors after failover.
Subscription notification pricing is unchanged. Charges settle to the account
in the background, normally within a minute. `x-lasso-balance-usd` is an
estimate after this charge, so consecutive responses can differ and a balance
can dip a few cents below zero; the next purchase repays it first.
`GET /api/v1/accounts/current` returns the settled balance.

## Hand the account to its owner

Only an unrestricted agent can request a claim link:

```http
POST https://lasso.sh/api/v1/accounts/current/claim-link
Authorization: Bearer <management token>
```

Give `claim_url` only to the owner. It works once, expires after 24 hours, and
a new link invalidates the old one. The owner opens it signed in, previews what moves and
chooses **Keep as a new account**, or **Add to** one of their accounts (the
button shows its name). Merging can't be undone. Either way every key and URL
keeps working. Issuing the link alone does not complete a claim.

A key created before agents existed, with no management token, requests its
account's claim link with the RPC key as Bearer. Claim links issued before
accounts went live no longer work; request a new one.

## Rotate, retarget or revoke

- `POST /api/v1/keys/<id>/rotate` with `{"grace_seconds":3600}` returns a new
  `key`, `rpc_url`, `ws_url` and `serving_ready`. HTTP 200 with
  `serving_ready: true` means the replacement is ready to use. HTTP 202 with
  `serving_ready: false` returns the committed replacement and `Retry-After: 1`.
  Save it, wait `Retry-After`, then call RPC with it. Keep any valid grace secret
  until `previous_valid_until` (up to 86,400 seconds) and retry RPC with the
  replacement, **not rotation**. Deploy the new secret within the overlap.
  Rotation keeps `allowed_profiles`, and URLs that name a deleted Custom
  profile keep their fallback. Rotation does not authorize Premium directly.
  If no usable allowed selector exists, `unknown_profile` leaves the secret,
  overlap and scope unchanged. Update `allowed_profiles` before rotating.
  Omitting `grace_seconds` gives 3,600 seconds (1 hour); sending 0 stops the old secret at once.

  For no downtime: rotate with a grace longer than your rollout plus a
  rollback, deploy the new secret everywhere, confirm calls succeed with it,
  then let the old secret lapse at `previous_valid_until`.
- `PATCH /api/v1/keys/<id>` with `{"allowed_profiles":["<slug>"]}` narrows
  authorization; it does not move an existing URL to that profile. Use its
  explicit profile URL. Bare URLs always select premium and return `forbidden`
  if premium is excluded, with explicit allowed routes in `next_action`.
  Submitted `default_profile` returns 422 `unknown_field` with URL guidance.
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

Lasso tracks each provider's block height from the head reads routed through
it and from background checks. A `ws_url` provides WebSocket capability;
`heads: live` selects a per-block `newHeads` feed, and `heads: standby`
supplies an elected fallback when no live feed is healthy. Unset `heads` means
passive.
A provider with the same URL and credentials in several profiles is tracked once.
On providers that bill per request, choose `heads: passive` for poll-based head
tracking or `heads: off` to disable periodic head collection for that reference,
retaining `ws_url` for client subscriptions. Off removes this reference’s periodic head demand; shared instances collect
heads for enabled references. Neither mode disables permitted identity/capability
checks or client subscription usage; `health_checks: light` slows background
polls and identity checks.

1. `?dry_run=true` returns the changes and each provider's chain check without
   storing anything, and needs no Custom access.
2. Holding a profile needs Custom access. An account that has never had Custom
   access gets five free days when it saves its first profile;
   `GET /api/v1/accounts/<id>` shows when they end under `subscriptions`.
   Otherwise, buy days with the same 402 exchange as a top-up: `POST /api/v1/accounts/<id>/custom-access` with
   `{"days":7}`, at `account_payments.custom_access.day_usd` in `/agent.json`.
   A signed offer keeps its price even if the tariff changes.
3. The same `PUT` without `dry_run` stores it. `provider_check_failed` names a
   wrong provider and nothing changes; a provider that can't answer yet is
   saved as `verifying` and routes once a later check passes.
4. Route the app over `https://lasso.sh/rpc/k/<key>/profile/prod-base/<strategy>/<chain>`.
   Replace the profile segment in an existing prefix rather than appending another.
5. When all desired providers for a chain are unverified, its entire previous
   verified configuration keeps serving, including its settings. A chain with
   both verified and verifying providers publishes the verified subset and its
   new settings immediately.
   A new chain without a verified serving predecessor gets a retryable 503
   `profile_config_unavailable` until an identity check verifies a provider.
   For a newly created profile, honor `retry_after_seconds` and GET until `live`
   before routing. `GET /api/v1/profiles/prod-base` shows the revision, each provider's status
   and what Lasso has learned (`effect: on` changes routing; `shadow` is
   observed only). Provider URLs and header values are never returned.

Omitting a provider removes it; omitting a provider's `url` keeps the stored
one. Omitted `heads` in a whole replacement resets that provider to passive.
`Accept: application/yaml` exports compatible head policies for self-hosted Lasso RPC
Core. A provider with `heads: standby` returns 422 `invalid_config` with its field
path because the target Core YAML cannot represent elected fallback; the stored
profile is unchanged. `DELETE` removes it; URLs naming it then serve as `premium`. When Custom
access lapses, the profile is kept and its URLs serve from `premium`, charged
at request prices, until renewed.

## Streams: ordered contract events (allowlisted beta)

Streams delivers ordered, reorg-safe contract logs or block headers from one URL.
Use an enabled account RPC key from an allowlisted beta account; the management
Bearer token manages saved recipes. A saved stream is optional and holds no key
or consumer position. RPC profile/strategy URL segments do not apply to Streams.

```bash
# Keep this credential-bearing URL in the app's secret store.
export LASSO_STREAM_URL="https://lasso.sh/streams/k/$LASSO_KEY/base/logs?address=$CONTRACT&from=latest"
curl -fsS "$LASSO_STREAM_URL&wait=20&consumer=indexer"
```

The beta serves Ethereum (`ethereum` or `1`), Base (`base` or `8453`), and Arbitrum (`arbitrum` or `42161`). Choose `/logs` or
`/blocks`. Logs accept `address` (at most 100 comma-separated addresses) and
`topic0`–`topic3` (comma-separated alternatives at each position; positions are
ANDed). Omit a filter to match anything. Headers take no address/topic filters.
`consumer` is a display label only. It changes neither data, billing identity
nor cursor encoding; resume the same cursor with a different label if desired.
`wait` is 0–30 seconds, default 20; use zero to drain pages in a cron job.
Position precedence is `Last-Event-ID`, then `cursor`, then `from`. Supply one:
`from` is a nonnegative decimal block or `latest`, which includes the current published tip
block. Keep cursors opaque and use them only with the same chain/source/filter.
A cold read or `from` above the published tip returns a successful pending page
with `retry_after`. Keep the supplied start or committed cursor and retry after
that delay; apply no pending data.

Every successful pull is HTTP 200 with one page, including quiet/no-op pages:

```json
{"chain":8453,"from":21004401,"through":{"number":21004410,"hash":"0x…"},"tip":21004410,"safe":null,"finalized":null,"cursor":"c1.…","items":[]}
```

`through`, `safe` and `finalized` identify blocks by number and hash. Marks may
be null; `through` and `cursor` may also be null on an initial pending page. Page numbers are decimal; item quantities are JSON-RPC hex.
Log items are `eth_getLogs` objects plus the validated header's `blockTimestamp`,
with no `removed` field. Blocks are headers without transaction, uncle or
withdrawal lists. Items are ordered by block number, then log index. Pages
contain at most 10,000 whole blocks, targeting 1 MiB of items with a 4 MiB ceiling; an oversized
single block is delivered whole, alone, or returns 503.

Finalized history trusts the routed provider outside the feed's known window.
A header contradicting a hash already verified by the feed is refused and tried
on the next provider. Per-stream history has no separate confirmation wave.
History is fetched in the background through the Streams routing profile. A
provider range refusal reduces the stream's span; encoded buffers bound page
volume. The feed seeds headers forward from finality and retains continuous
header coverage through its published tip. Payloads are retained only for the
hot tail. A cold successful page can carry `retry_after` with a null cursor or
through value: keep the original `from` or committed cursor, wait that many
seconds, and retry without applying the pending page.

Apply every completed page, including empty corrections, in exactly one transaction:

```text
delete this source's rows where block_number >= page.from
insert page.items
save page.cursor
```

A correction may rewind below the original start or end below the old head.
When `through.number == from - 1`, it contains no blocks. A cursor ahead of the
verified tip waits and can receive a no-op echoing that cursor; this differs
from a fresh `from` above tip. Persist the cursor with the rows, never on receipt.

If a connection ends, reconnect from the committed cursor and follow the returned error.

### Pull loop

Save this as `streams.py`. `STREAM_ID` is a credential-free local name for the
fixed chain/source/filter. Use a different ID/database when changing filters.
Set `START_BLOCK` to a block you trust for an explicit rebuild. This example
uses Python's standard library and SQLite; put your materialized model updates
inside `apply_page`'s transaction.

```python
import json, os, sqlite3, time
from http.client import IncompleteRead
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

URL = os.environ["LASSO_STREAM_URL"]
SOURCE = os.environ.get("STREAM_ID", "contract-logs")
START = os.environ["START_BLOCK"]
db = sqlite3.connect("streams.sqlite")
db.executescript("""
CREATE TABLE IF NOT EXISTS items (source TEXT, block INTEGER, payload TEXT);
CREATE TABLE IF NOT EXISTS positions (source TEXT PRIMARY KEY, cursor TEXT);
""")

def request_url():
    u = urlsplit(URL)
    q = dict(parse_qsl(u.query))
    q.pop("from", None)
    q.pop("cursor", None)
    row = db.execute("SELECT cursor FROM positions WHERE source=?", (SOURCE,)).fetchone()
    q["cursor" if row and row[0] else "from"] = row[0] if row and row[0] else START
    q["wait"] = "20"
    return urlunsplit((u.scheme, u.netloc, u.path, urlencode(q), ""))

def apply_page(page):
    if page.get("retry_after"):
        time.sleep(page["retry_after"])
        return  # keep START and the last committed cursor; apply no pending data
    with db:
        db.execute("DELETE FROM items WHERE source=? AND block>=?", (SOURCE, page["from"]))
        db.executemany("INSERT INTO items VALUES (?,?,?)", [
            (SOURCE, int(item.get("blockNumber", item.get("number")), 16), json.dumps(item))
            for item in page["items"]
        ])
        db.execute("INSERT OR REPLACE INTO positions VALUES (?,?)", (SOURCE, page["cursor"]))

def rebuild_source():
    with db:
        db.execute("DELETE FROM items WHERE source=?", (SOURCE,))
        db.execute("DELETE FROM positions WHERE source=?", (SOURCE,))

def handle_http(error):
    if error.code in (401, 402, 403):
        raise SystemExit(f"Streams HTTP {error.code}; inspect the response privately")
    if error.code == 409:
        rebuild_source()  # rebuild only this source from START
    else:
        time.sleep(int(error.headers.get("Retry-After", "2")))

def handle_control(body):
    error = body["error"]
    code = error["code"] if isinstance(error, dict) else error
    if code in ("unauthorized", "balance_exhausted", "not_entitled"):
        raise SystemExit(f"Streams {code}; inspect the control body privately")
    if code == "resync_required":
        rebuild_source()
    else:
        time.sleep(body.get("retry_after", 2))  # keep the committed cursor

def pull():
    while True:
        request = Request(request_url())
        try:
            with urlopen(request, timeout=40) as response:
                page = json.load(response)
        except HTTPError as error:
            handle_http(error)
            continue
        except (OSError, IncompleteRead, json.JSONDecodeError):
            time.sleep(2)
            continue  # an incomplete page never reaches the transaction
        apply_page(page)  # database and apply errors remain fatal

if __name__ == "__main__":
    pull()
```

### SSE

The same URL accepts `Accept: text/event-stream`. Each page has `id: <cursor>`
and `data: <page>`, with no `event:` field (the default `message` event).
After the first page, quiet SSE waits have a one-second minimum even at `wait=0`.

```bash
curl -N -H 'Accept: text/event-stream' "$LASSO_STREAM_URL&wait=20"
```

For persisted consumers, pull is the simplest transport. To consume SSE, save
this beside `streams.py`. It reuses the same synchronous transaction and resumes
from the committed cursor after a disconnect. An apply error exits and closes
the connection; restart only after fixing it. Do not let EventSource's automatic
last-delivered ID advance past an uncommitted page.

```python
from streams import *

def read_event(response):
    data, event = [], "message"
    for raw in response:
        line = raw.decode().rstrip("\r\n")
        if not line:
            if data:
                return event, json.loads("\n".join(data))
            event = "message"
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))
    return None  # discard an unfinished event on disconnect

while True:
    request = Request(request_url(), headers={"Accept": "text/event-stream"})
    try:
        response = urlopen(request, timeout=40)
    except HTTPError as error:
        handle_http(error)
        continue
    except (OSError, IncompleteRead):
        time.sleep(2)
        continue
    with response:
        while True:
            try:
                message = read_event(response)
            except (OSError, IncompleteRead, json.JSONDecodeError, UnicodeDecodeError):
                time.sleep(2)
                break
            if message is None:
                time.sleep(2)
                break
            event, body = message
            if event == "error":
                handle_control(body)
                break  # close, then retry/rebuild from the database position
            if event == "message":
                apply_page(body)  # outside transport recovery; failures close the connection

```

### Errors and funding

| HTTP | Code | Continue with |
|---|---|---|
| 400 | `invalid_cursor`, `invalid_parameter` | Correct the input; changing a source/filter requires a fresh start |
| 401 | `unauthorized` | An enabled current key; SSE sends an error and closes if authority expires |
| 402 | `balance_exhausted` | Fund within the user's budget, then resume the committed cursor |
| 403 | `not_entitled` | An allowlisted account with Streams access |
| 404 | `chain_not_served` | A chain supported by Streams |
| 409 | `resync_required` | Rebuild this source from a trusted start; this is not a transient upstream failure |
| 429 | `too_many_readers` | Close extra readers before retrying |
| 429 | `rate_limit_exceeded` | Honor `Retry-After` when present; otherwise back off before retrying |
| 503 | `chain_unavailable` | Honor `Retry-After`; retry the same committed position |
| 503 | `history_unavailable` | No usable history page or prefix; honor `Retry-After` and retain the committed cursor |

HTTP errors other than 402 use `{"error":"<code>", ...details}`, with optional
`reason`, `expected_source` or rejected `anchor`. HTTP 503 always includes
`Retry-After: <seconds>` (1–30); managed account rate-limit 429 can include it,
while reader/auth-limit 429 need not. JSON pull uses chunked framing without
`Content-Length`. A page is complete only when the response finishes cleanly.
An aborted HTTP/1 connection or a reset HTTP/2 stream means retry from the last
committed cursor without applying the partial page. Responses other than 402
set `Cache-Control: no-store` and `X-Accel-Buffering: no`.

Pull 402 carries `payment-required` (x402) / `www-authenticate` (MPP) when available,
`Cache-Control: no-store`, and
`error: {code, message, challenges, credit, next_action}`. `credit` supplies a
`POST` href and prefers `{usd: "1.00"}`, the smallest purchase currently allowed.
The amount adapts to enabled payment rails' minimum and maximum. Use the returned amount and the existing funding
recipe, within the user's purchase budget: pay an offer or top up using the
returned credit action, then resume from your committed cursor. SSE sends an `event: error` containing the same JSON
body, `retry: 60000`, no cursor ID, then closes. Other failures after SSE starts
send `event: error` with the string-code body and close. Before the first SSE
page, failures return the normal HTTP status and JSON instead. Control events
are not pages. Retry `chain_unavailable` and `history_unavailable` controls and HTTP 503 from the committed
cursor; `resync_required` rebuilds this source from `START_BLOCK`. Authorization
and funding controls stop the recipe for user action.

A key has at most 10 concurrent readers (`429 too_many_readers`) and 2 concurrent
history builds. `503 history_unavailable` with `all_circuits_open` refuses before
upstream work when every serving circuit is open. `read_unavailable` means a
history read could not return a usable prefix without a more specific upstream
cause. Upstream refusals can retain their category as `reason`, with `provider`,
`code` and `category` fields. Refusals carry no items or cursor and do not rebuild
internally within `wait`. Keep the committed cursor and retry
after HTTP `Retry-After` or the SSE control body's `retry_after` seconds.
This does not mean the requested history depth is unsupported. Feed/page
capacity failures can still return `503 chain_unavailable`.
Account request-rate limits and key revocation also apply. Delivery costs
**$0.10 per million events**, with a **$0.10 minimum per account per active UTC
day**, charged from the same USD balance as RPC. Live, history, replay and reorg
correction items count; each block header is one event. A successful empty
public page activates the day but adds no event charge. Errors, keepalives and
blocks scanned are free. Passive dashboard board samples are free and do not
activate a day. The dashboard Test reader delivers through the public key
endpoint and is billed like every reader, including successful empty pages.
The beta does not offer free interactive reads. Pro included usage
does not pay for Streams. `/agent.json` publishes the versioned UTC-day tariff.

### Saved streams and usage

Use the account's management Bearer token for these JSON APIs. Profile-scoped agents cannot manage Streams; read-only agents can read.
All these routes require beta access; management refusal is `403 not_in_beta`.

| Method | Path | Body/result |
|---|---|---|
| GET | `/api/v1/streams` | `{streams, limits}` |
| POST | `/api/v1/streams` | `{name, chain_id, source: "logs" or "blocks", parameters}` → 201 recipe |
| GET | `/api/v1/streams/{id}` | Recipe with credential-free `url_template` |
| PATCH | `/api/v1/streams/{id}` | `{name}` → renamed recipe |
| DELETE | `/api/v1/streams/{id}` | 204 |
| GET | `/api/v1/streams/usage` | Account `days` and attributed `sources` |
| GET | `/api/v1/streams/{id}/usage` | Account `days`, sources matching this recipe |

At most 100 saved recipes per account; delete one to free a slot. Parameters
normalize address/topic strings or arrays into sorted unique lowercase arrays;
`from`, `wait` and `consumer` describe the connection. Keys and cursors are never
saved. Build the public URL by substituting a key into `url_template` locally.
Usage accepts `from_day` and `through_day` ISO dates, at most 31 days, default
seven. It reports events, bytes and USD/nanodollar cost after background flush.
Day totals and the daily minimum are account-wide even on a recipe's endpoint;
sources show event charges. Recipes with the same chain/source/filter share
attribution. Do not sum their repeated day totals as separate charges.

### Side effects: finalized outbox

In the page-apply transaction, keep the highest `finalized.number` ever observed
for this chain, retaining it across lower/null marks and restarts. Enqueue outbox
jobs for canonical rows at or below that mark, with unique keys such as
`chain_id + transactionHash + logIndex` (chain and block hash for headers).
Keep outbox acknowledgements outside the
rows rebuilt by the page rule. A worker sends each job with the same recipient
idempotency key on retry, then records acknowledgement; a lost acknowledgement
can repeat a send, so the receiver must deduplicate it. Finality marks are the
confirmation signal. Acting at `safe` instead requires compensating effects for
deleted rows (`DELETE ... RETURNING` yields the retraction list).

## What stays with the app

Replay-safe reads fail over within one deadline and a bounded number of
upstream dispatches.

A signed transaction is resent as the same bytes to the next provider, up to
three in total within one deadline, when a provider rate-limits it, times out
or rejects it for a node-local reason. A sender fault such as insufficient
funds or nonce too low stops at the first provider. A request pinned to one
provider (`/rpc/provider/<id>/<chain>`) goes to that provider only. When every
attempt fails and the deadline has time left, Lasso asks one provider (the last
one that answered, if any) for the transaction by hash and returns the hash
instead of the error if it is pending or mined. Resending the same signed bytes
is always safe.

The app owns signing, nonces, replacement, receipts and finality. HTTP filter IDs are
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

RPC and account-management errors carry `code` and `next_action`; follow it.
Streams read errors use the shapes in [Errors and funding](#errors-and-funding).

| Code | Fix |
|---|---|
| 402 `balance_exhausted` | POST to `error.data.credit_url` to credit the account, or subscribe |
| 403 `forbidden` on RPC | The key is scoped; use a profile `next_action` lists |
| 404 `unknown_profile` | Use a profile `next_action` lists |
| 401 `key_revoked` | The key was revoked or rotated past its overlap; use the current key |
| 422 `rpc_route_required` | Add `/<chain>` or `/<strategy>/<chain>` to the URL |
| 422 `unknown_chain`, `unknown_strategy` | Use a value from `/agent.json` (`ethereum`, not `mainnet`) |
| `-32005` `log_range_limit`, or `timeout` on `eth_getLogs` | Narrow the `eth_getLogs` block range |
| `custom_access_required` | Buy Custom access or have the owner subscribe |
| `payment_conflict`, `payment_pending` or payment 202 | Read `GET /api/v1/purchases/<id>` using the returned purchase ID; never pay again |
| 409 `beneficiary_conflict` | Never pay again; keep the purchase ID and signed payment, report the key with `POST /api/v1/feedback`, then retry the same request |
| Rotation 202 with `serving_ready: false` | Honor `Retry-After`; retain valid grace authority and retry replacement RPC, not rotation |
| 429 `rate_limit_exceeded` (RPC) or `rate_limited` (management API) | Honor `Retry-After` |
| 503 `unavailable` | Check disabled capabilities in `/agent.json`; follow the refusal’s `next_action` and `Retry-After`, retry the same operation and retain its original payment identity. Never pay twice. |

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

### Streams billing delivery boundary

Streams bills complete pages successfully written to the connection by the
server, not client acknowledgments. A fully written SSE frame can be billable
even if a disconnect prevents the client from consuming it. Truncated or failed
page writes are free; successful replay deliveries bill again.
