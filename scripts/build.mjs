// Builds one unpacked extension and one store-ready zip per browser into dist/.
//
//   node scripts/build.mjs            all targets
//   node scripts/build.mjs firefox    one target
//
// manifest.json in the repo root is the source of truth; each target gets a
// copy with the keys that browser doesn't use removed.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

// Chromium browsers load the service worker and reject Firefox-only keys;
// Firefox runs MV3 backgrounds as event pages from `scripts`.
const chromium = (m) => {
  const { browser_specific_settings: _, ...rest } = m;
  const { scripts: __, ...background } = m.background;
  return { ...rest, background };
};
const firefox = (m) => {
  const { service_worker: _, ...background } = m.background;
  return { ...m, background };
};

const TARGETS = {
  chrome: chromium,
  edge: chromium,
  opera: chromium,
  firefox,
  // Safari is packaged by Xcode from this folder (scripts/build-safari.sh).
  safari: chromium,
};

function build(name) {
  const out = join(dist, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(TARGETS[name](source), null, 2)}\n`);

  if (name === 'safari') return out;
  const zip = join(dist, `slyfox-${name}-${source.version}.zip`);
  rmSync(zip, { force: true });
  // Stores require manifest.json at the zip root, so zip from inside the folder.
  execFileSync('zip', ['-r', '-q', '-X', zip, '.', '-x', '.*'], { cwd: out });
  return zip;
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(TARGETS);
for (const name of names) {
  if (!TARGETS[name]) {
    console.error(`Unknown target "${name}". Choose from: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
  console.log(`${name.padEnd(8)} ${build(name)}`);
}
