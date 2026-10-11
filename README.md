# Slyfox

A browser extension that summarizes the terms and conditions on a page and flags the catches, each linked back to the exact passage. It uses your own Sarvam AI API key and has no backend.

## Set up

Needs Node 22.18 or newer (it runs the TypeScript tests and build script directly) and pnpm.

```bash
pnpm install
```

## Build and load it

```bash
pnpm build
```

This compiles the TypeScript in `src/` and writes an unpacked extension and a store-ready zip per browser to `dist/`. `manifest.json` in the repo root is the source; each build drops the keys that browser doesn't use.

| Browser | Load locally | Store package |
| --- | --- | --- |
| Chrome | `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chrome` | `dist/slyfox-chrome-<version>.zip` |
| Edge | `edge://extensions` → Developer mode → **Load unpacked** → `dist/edge` | `dist/slyfox-edge-<version>.zip` |
| Opera | `opera://extensions` → Developer mode → **Load unpacked** → `dist/opera` | `dist/slyfox-opera-<version>.zip` |
| Firefox 140+ | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/firefox/manifest.json` | `dist/slyfox-firefox-<version>.zip` |
| Safari | `pnpm build:safari` (needs Xcode), open the built app, then Safari → Develop → **Allow Unsigned Extensions** and enable Slyfox in Settings → Extensions | Archive and submit the Xcode project in `dist/safari-xcode` |

Then open the extension's settings, paste your Sarvam API key, pick a model and reasoning level, and save. Slyfox checks the key and model before saving. In Firefox, saving also asks for permission to reach `api.sarvam.ai`.

## Use it

Open a terms page and click the Slyfox toolbar button. A panel opens on the right. Click a quote to scroll to it and highlight it on the page. Click the button again, or the ×, to close the panel. Navigating to another page removes it.

## How it works

| Step | Where | File |
| --- | --- | --- |
| Extract visible text into numbered segments | Page | `src/content/content.ts` |
| Scrub PII (email, phone, card, Aadhaar, PAN, IFSC, IP) | Background | `src/lib/scrub.ts` |
| Character and token limits | Background | `src/lib/budget.ts` |
| Screen for prompt injection, then analyze | Background → Sarvam | `src/lib/pipeline.ts`, `src/lib/prompts.ts`, `src/lib/sarvam.ts` |
| Drop any quote not found in its segment | Background | `src/lib/verify.ts` |
| Render the panel and highlights | Page | `src/content/content.ts` |

The API key is stored in `storage.local` and read only by the background worker and the settings page. Model output only enters the page as text nodes.

The page script is injected with `scripting.executeScript`, so it must compile to a classic script with no imports. Types it shares with the rest of the code live in the ambient `src/types.d.ts`.

## Develop

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Type-checks the extension (`tsconfig.json`) and the tests and scripts (`tsconfig.node.json`) |
| `pnpm test` | Runs the unit tests with Node's built-in runner, straight from TypeScript |
| `pnpm build [target…]` | Compiles and packages all targets, or only the ones named (`chrome`, `edge`, `opera`, `firefox`, `safari`) |
| `pnpm lint:firefox` | Lints `dist/firefox` the way addons.mozilla.org does |

Source files import each other with `.ts` extensions so Node can run them directly; the compiler rewrites them to `.js` in the build.

For a manual check, serve the repo (`python3 -m http.server`) and open `test/fixtures/terms.html`: it contains hidden injection text, a collapsed section, and fake personal details.

## Releases

Every push to `main` type-checks, runs the tests, builds the store packages, lints the Firefox build, and publishes a GitHub release tagged `v<version>-build.<run number>` with the Chrome, Edge, Opera and Firefox zips attached ([.github/workflows/release.yml](.github/workflows/release.yml)). Bump `version` in `manifest.json` for a new store version. Safari isn't built in CI because it needs Xcode and signing.
