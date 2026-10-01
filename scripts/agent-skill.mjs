// Mirrors https://lasso.sh/SKILL.md byte for byte into the Mintlify skill directory.
// Usage: node scripts/agent-skill.mjs [--check] [--source <url>]
// --check exits 1 when the committed copy differs from the served file.
import {readFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const flag = args.indexOf('--source');
const source = flag >= 0 ? args[flag + 1] : 'https://lasso.sh/SKILL.md';
const target = '.mintlify/skills/lasso/SKILL.md';

const response = await fetch(source);
if (!response.ok) throw new Error(`${source} answered ${response.status}`);
const served = Buffer.from(await response.arrayBuffer());

if (!check) {
  writeFileSync(target, served);
  console.log(`${target} written from ${source}`);
} else if (!served.equals(readFileSync(target))) {
  console.error(`${target} differs from ${source}; run node scripts/agent-skill.mjs`);
  process.exit(1);
} else {
  console.log(`${target} matches ${source}`);
}
