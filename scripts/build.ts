// Compiles the TypeScript sources, then writes one unpacked extension and
// one store-ready zip per browser into dist/.
//
//   pnpm build            all targets
//   pnpm build firefox    one target
//
// manifest.json in the repo root is the source of truth; each target gets a
// copy with the keys that browser doesn't use removed.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Manifest {
  version: string;
  background: { service_worker?: string; scripts?: string[]; type?: string };
  browser_specific_settings?: unknown;
  [key: string]: unknown;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const compiled = join(root, 'build');
const dist = join(root, 'dist');
const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Manifest;

// Chromium browsers load the service worker and reject Firefox-only keys;
// Firefox runs MV3 backgrounds as event pages from `scripts`.
const chromium = (m: Manifest): Manifest => {
  const { browser_specific_settings: _settings, ...rest } = m;
  const { scripts: _scripts, ...background } = m.background;
  return { ...rest, background };
};
const firefox = (m: Manifest): Manifest => {
  const { service_worker: _worker, ...background } = m.background;
  return { ...m, background };
};

const TARGETS: Record<string, (m: Manifest) => Manifest> = {
  chrome: chromium,
  edge: chromium,
  opera: chromium,
  firefox,
  // Safari is packaged by Xcode from this folder (scripts/build-safari.sh).
  safari: chromium,
};

function compile() {
  rmSync(compiled, { recursive: true, force: true });
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });
}

function build(name: string, transform: (m: Manifest) => Manifest): string {
  const out = join(dist, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // HTML and CSS come from src/, compiled JavaScript from build/.
  cpSync(join(root, 'src'), join(out, 'src'), { recursive: true, filter: (path) => !path.endsWith('.ts') });
  cpSync(compiled, join(out, 'src'), { recursive: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(transform(source), null, 2)}\n`);

  if (name === 'safari') return out;
  const zip = join(dist, `slyfox-${name}-${source.version}.zip`);
  rmSync(zip, { force: true });
  // Stores require manifest.json at the zip root, so zip from inside the folder.
  execFileSync('zip', ['-r', '-q', '-X', zip, '.', '-x', '.*'], { cwd: out });
  return zip;
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(TARGETS);
const unknown = names.filter((name) => !TARGETS[name]);
if (unknown.length) {
  console.error(`Unknown target "${unknown.join('", "')}". Choose from: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

compile();
for (const name of names) {
  console.log(`${name.padEnd(8)} ${build(name, TARGETS[name]!)}`);
}
