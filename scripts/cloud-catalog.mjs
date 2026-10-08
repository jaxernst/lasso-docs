// Renders the Lasso Cloud chain, price and error tables.
// Chains come from the live service manifest, errors from the error catalog
// the live OpenAPI document publishes, and prices from the account tariff
// file in lasso-cloud (config/account_model_tariffs.exs), which is what Lasso
// charges. The file is Elixir, so `elixir` evaluates it; --tariff-version
// picks a version, otherwise the newest one prices the tables.
// Usage: node scripts/cloud-catalog.mjs --tariff <path> [--tariff-version <v>]
//          [--check] [--manifest <url-or-path>] [--openapi <url-or-path>]
// --check exits 1 when the committed snippets differ from the sources.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const check = args.includes('--check');
const source = option('--manifest') ?? 'https://lasso.sh/agent.json';
const tariffPath = option('--tariff');
if (!tariffPath) throw new Error('--tariff <path to account_model_tariffs.exs> is required');

const load = async from =>
  from.startsWith('http')
    ? await (await fetch(from, {headers: {accept: 'application/json'}})).json()
    : JSON.parse(readFileSync(from, 'utf8'));
const manifest = await load(source);
const openapiSource = option('--openapi') ?? 'https://lasso.sh/openapi.json';
// Until the service publishes x-error-catalog, the error tables come from the
// release source through scripts/cloud-errors-from-source.exs.
const catalog = (await load(openapiSource))['x-error-catalog'];

const row = cells => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

// Evaluates the tariff file, a map or a list of versioned maps, to JSON with
// rationals {n, d} as [n, d].
const evaluate = `
[path, wanted] = System.argv()
tariffs = path |> Code.eval_file() |> elem(0) |> List.wrap()
tariff = if wanted == "", do: List.last(tariffs), else: Enum.find(tariffs, &(&1.version == wanted))
tariff || raise "no tariff #{wanted} in #{path}"
plain = fn
  f, m when is_map(m) -> Map.new(m, fn {k, v} -> {to_string(k), f.(f, v)} end)
  _, {n, d} -> [n, d]
  _, v -> v
end
IO.puts(JSON.encode!(plain.(plain, tariff)))
`;

function loadTariff(path, version = '') {
  const raw = JSON.parse(execFileSync('elixir', ['-e', evaluate, path, version], {encoding: 'utf8'}));
  const ratio = ([n, d]) => n / d;
  const factors = Object.fromEntries(
    Object.entries(raw.strategy_factors).map(([k, v]) => [k.replaceAll('_', '-'), ratio(v)]),
  );
  const weights = Object.fromEntries(Object.entries(raw.method_weights).map(([k, v]) => [k, ratio(v)]));
  return {
    version: raw.version,
    unitNanos: raw.unit_nanos,
    factors,
    weights,
    notificationWeight: ratio(raw.notification_weight),
    includedCu: raw.included_cu,
    startingGrantNanos: raw.starting_grant_nanos,
    customDayNanos: raw.custom_day_nanos,
  };
}

const usd = nanos => `$${(nanos / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '')}`;

function chains({chains}) {
  if (!Array.isArray(chains) || chains.length === 0) throw new Error('manifest has no chains');
  const rows = [...chains]
    .sort((a, b) => a.chain_id - b.chain_id)
    .map(({name, chain_id}) => [`\`${name}\``, String(chain_id)]);
  return table(['Chain name', 'Chain ID'], rows);
}

// Lasso answers HTTP filter methods with -32601 (cloud/rpc-behavior), so the
// tariff's weights for them never apply.
const rejected = new Set([
  'eth_newFilter',
  'eth_newBlockFilter',
  'eth_newPendingTransactionFilter',
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_uninstallFilter',
]);

function prices({unitNanos, factors, weights}) {
  const order = ['load-balanced', 'latency-weighted', 'fastest', 'priority'].filter(id => id in factors);
  const {_default: fallback, ...served} = weights;
  const named = Object.fromEntries(Object.entries(served).filter(([method]) => !rejected.has(method)));
  const cells = weight => [String(weight), ...order.map(id => usd(weight * factors[id] * unitNanos))];
  const rows = Object.keys(named).sort().map(method => [`\`${method}\``, ...cells(named[method])]);
  if (fallback) rows.push(['Any other method', ...cells(fallback)]);
  return table(['Method', 'Weight (CU)', ...order.map(id => `\`${id}\``)], rows);
}

const count = value => Number(value).toLocaleString('en-US');
const times = factor => `${factor}x`;

function terms(t) {
  const order = ['load-balanced', 'latency-weighted', 'fastest', 'priority'];
  return table(['Item', 'Value'], [
    ['Rate', `${usd(t.unitNanos)} per CU`],
    ['Strategy factors', order.map(id => `\`${id}\` ${times(t.factors[id])}`).join(', ')],
    ['Subscription notification', `${t.notificationWeight} CU`],
    ['Starting grant for a new provisional account', usd(t.startingGrantNanos)],
    ['Free access', `${count(t.includedCu.free)} CU per month`],
    ['Pro included usage', `${count(t.includedCu.pro)} CU per month`],
  ]);
}

// Pipes and line breaks would break a Markdown table cell; MDX reads < as a
// tag and { as an expression.
const cell = text =>
  String(text)
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
    .replaceAll('<', '&lt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;');

function errors(entries, withRetry) {
  const rows = [...entries]
    .sort((a, b) => a.status - b.status || a.code.localeCompare(b.code))
    .map(e => [
      `\`${e.code}\``,
      String(e.status),
      ...(withRetry ? [e.retryable == null ? 'Varies' : e.retryable ? 'Yes' : 'No'] : []),
      cell(e.next_action),
    ]);
  return table(['Code', 'HTTP', ...(withRetry ? ['Retryable'] : []), 'Fix'], rows);
}

const tariff = loadTariff(tariffPath, option('--tariff-version'));
const outputs = {
  'snippets/cloud-chains.mdx': [`{/* Generated by scripts/cloud-catalog.mjs from ${source}. Do not edit. */}`, chains(manifest)],
  'snippets/cloud-tariff.mdx': [`{/* Generated by scripts/cloud-catalog.mjs from tariff ${tariff.version}. Do not edit. */}`, terms(tariff)],
  'snippets/cloud-prices.mdx': [`{/* Generated by scripts/cloud-catalog.mjs from tariff ${tariff.version}. Do not edit. */}`, prices(tariff)],
  ...(catalog && {
    'snippets/cloud-errors-management.mdx': [`{/* Generated by scripts/cloud-catalog.mjs from the x-error-catalog in openapi.json. Do not edit. */}`, errors(catalog.management, false)],
    'snippets/cloud-errors-rpc.mdx': [`{/* Generated by scripts/cloud-catalog.mjs from the x-error-catalog in openapi.json. Do not edit. */}`, errors(catalog.rpc, true)],
  }),
};

let drift = false;
for (const [path, [banner, body]] of Object.entries(outputs)) {
  const text = `${banner}\n\n${body}\n`;
  if (!check) {
    writeFileSync(path, text);
    continue;
  }
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {}
  if (current !== text) {
    drift = true;
    console.error(`${path} differs from its source; run node scripts/cloud-catalog.mjs --tariff <path>`);
  }
}

if (drift) process.exit(1);
console.log(`Cloud catalog ${check ? 'matches' : 'written from'} ${source}, ${openapiSource} and tariff ${tariff.version}`);
