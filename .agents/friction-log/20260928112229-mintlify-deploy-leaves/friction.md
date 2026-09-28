---
title: 'Mintlify deploy leaves llms-full.txt cached for 24 hours'
severity: 'minor'
---

## What I was doing
Publishing the Core v0.5.0 and Cloud Agent API v2 docs after merging docs PR #44 as `84e0707e61f9560571853089b45a915488a08a72` on September 28, 2026.

## Expected
After `Mintlify Deployment` succeeded for the merged SHA, the canonical `https://docs.lasso.sh/llms-full.txt` agent export would contain the new release and API text, like the updated HTML pages and `.md` exports.

## Observed
The check concluded successfully at 18:17:33 UTC. HTML pages and `.md` exports showed the new Cloud SHA `62bda27e2756507b1ca89b43396fe178c7308816`, but the bare `llms-full.txt` URL still served pre-merge content. Its response headers reported `cf-cache-status: HIT`, `age: 32647`, `cache-control: public, max-age=86400`, and `last-modified: Mon, 28 Sep 2026 09:15:38 GMT`. A cache-busted URL immediately served the new content. `Cache-Control: no-cache` on the request did not bypass the stale Cloudflare object. The short `llms.txt` index revalidated separately and was current.

## Reproduce
1. Merge a docs change that affects the generated full agent export.
2. Wait for `Mintlify Deployment` success on the merged commit.
3. Compare `curl -fsS https://docs.lasso.sh/llms-full.txt` with `curl -fsS 'https://docs.lasso.sh/llms-full.txt?sync=<merged-sha>'` and inspect headers using `curl -sSI`.

## Workaround and follow-up
Use the cache-busted URL to verify the origin-generated export, but keep canonical export publication marked unverified until the bare URL refreshes. Investigate cache invalidation or a shorter edge TTL for generated agent exports; a green Mintlify check alone does not establish that canonical `llms-full.txt` is current.
