import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page = name => readFileSync(name, 'utf8');
const blocks = text => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]));
const metadata = blocks(page('observability/request-metadata.mdx'));
const formats = blocks(page('api/response-formats.mdx'));
for (const name of ['success', 'failover']) {
  const expected = JSON.parse(page(`fixtures/core-v0.4.3/${name}.json`));
  assert(metadata.some(actual => JSON.stringify(actual) === JSON.stringify(expected)), `${name} missing from metadata page`);
  if (name === 'success') assert(formats.some(actual => JSON.stringify(actual) === JSON.stringify(expected)));
  assert.deepEqual(JSON.parse(Buffer.from(page(`fixtures/core-v0.4.3/${name}-header.txt`).trim(), 'base64url')), expected.lasso_meta);
}
const failover = JSON.parse(page('fixtures/core-v0.4.3/failover.json')).lasso_meta;
assert.deepEqual(failover.attempted_channels.map(a => a.channel.provider_id), ['primary', 'backup']);
assert.equal(failover.executed_channel.provider_id, 'backup');
assert.equal(failover.attempted_channels[1].code, null);
assert(!Object.hasOwn(failover, 'head_policy'));
for (const file of ['concepts/routing-strategies.mdx', 'concepts/provider-selection.mdx', 'api/routing-strategies.mdx', 'advanced/benchmarking.mdx']) {
  assert(!/FASTEST_MIN_|LW_MS_FLOOR|LW_EXPLORE_FLOOR|LW_MIN_CALLS|LW_MIN_SR/.test(page(file)), file);
}
const exhaustion = JSON.parse(page('fixtures/core-v0.4.5/exhaustion.json'));
assert(blocks(page('api/error-codes.mdx')).some(actual => JSON.stringify(actual) === JSON.stringify(exhaustion)));
assert.deepEqual(Object.keys(exhaustion.error.data), ['reason', 'retry_after_ms', 'upstream_attempts']);
console.log('Core reference examples: JSON, schema fixture parity, header encoding and removed controls passed');
