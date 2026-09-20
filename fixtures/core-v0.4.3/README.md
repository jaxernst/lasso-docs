# Core v0.4.3 reference fixtures

Source: `42415b421c1af2e5e582130e96ee0688f2b21fd0` (`v0.4.3`).
These are hermetic outputs of the released `Observability.build_client_metadata`,
`ObservabilityPlug.enrich_response_body`, and `RequestContext` channel-history
helpers. The primary/backup scenario follows Core's
`test/integration/request_pipeline_integration_test.exs`. No RPC traffic occurs;
identities, timings and result values are fixed illustrative inputs. This is a
metadata contract check, not a transport or performance qualification.

Reproduce with a compiled Core v0.4.3 checkout (`MIX_ENV=test mix compile`) and its
dependencies. From this docs repo, in Bash:

```bash
# CORE_SOURCE points to your separate v0.4.3 checkout.
test "$(git -C "$CORE_SOURCE" rev-parse HEAD)" = 42415b421c1af2e5e582130e96ee0688f2b21fd0
paths=()
for path in "$CORE_SOURCE"/_build/test/lib/*/ebin; do paths+=(-pa "$path"); done
DOCS_FIXTURE_OUTPUT="$PWD/fixtures/core-v0.4.3" elixir "${paths[@]}" \
  scripts/core-reference-fixtures.exs \
  concepts/routing-strategies.mdx concepts/provider-selection.mdx
node scripts/check-core-reference.mjs
```

The generator also passes both retained complete YAML bodies through the released
`FileSchema.validate_body!` and `validate_chains!`. The two metadata examples
preserve nested null fields, omit absent top-level head-policy evidence, and
round-trip through the released base64url encoder. The Node check compares page
examples against the fixture files and rejects invalid JSON examples.

The exhaustion example uses the released error serializer and matches the
all-circuits-open controller regression, with a fixed five-second retry input.
It does not claim every exhaustion error has the same message or retry field.

## Compatibility with v0.4.4

All ten source-file SHA-256 values in `source.json` also match released source
`291c57162f382e5680cc218c7627972a9c5204f2` (`v0.4.4`). The retained outputs therefore
continue to describe the unchanged metadata, serializer and profile-schema
contracts. Their generation provenance remains v0.4.3; they do not exercise the
v0.4.4 fallback-order change.
