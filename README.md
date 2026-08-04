# Lasso documentation

This repository is the source for [docs.lasso.sh](https://docs.lasso.sh).

The site documents two related products:

- **Lasso Cloud** — the managed service, dashboard, account-owned profiles,
  keys, billing, usage, and agent workflows.
- **Lasso RPC Core** — the open-source routing engine, self-hosted
  configuration, deployment, and implementation reference.

`docs.json` defines the shared product navigation. Cloud content lives in
`cloud/`; RPC Core content is organized by concepts, configuration, deployment,
observability, advanced behavior, and API reference.

## Local development

Install the [Mintlify CLI](https://www.npmjs.com/package/mint), then run:

```bash
mint dev
```

Before publishing, validate links with:

```bash
mint broken-links
```

Mintlify deploys the `main` branch to the production documentation site.
