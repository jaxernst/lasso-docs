> For Mintlify product knowledge (components, configuration, writing standards),
> install the Mintlify skill: `npx skills add https://mintlify.com/docs`

# Documentation project instructions

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Run `mint dev` to preview locally
- Run `mint broken-links` to check links

## Terminology

- Use **Lasso Cloud** for the managed product.
- Use **Lasso RPC Core** for the open-source routing engine.
- Use **managed profile** for a Lasso-operated provider pool and **custom
  profile** for an account-owned provider pool.

## Style preferences

{/* Add any project-specific style rules below */}

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

- Do not expose provider credentials, internal operator identifiers, or
  implementation-only Cloud administration procedures.
- Put product workflows and boundaries under `cloud/`.
- Keep self-hosting and implementation details in the RPC Core sections.
- Link to live pricing, chain, and OpenAPI resources instead of copying values
  that can change.
