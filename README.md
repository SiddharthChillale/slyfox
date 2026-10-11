# Slyfox

A browser extension that summarizes the terms and conditions on a page and flags the catches, each linked back to the exact passage. It uses your own Sarvam AI API key and has no backend.

## Build and load it

```bash
npm run build
```

This writes an unpacked extension and a store-ready zip per browser to `dist/`. `manifest.json` in the repo root is the source; each build drops the keys that browser doesn't use.

| Browser | Load locally | Store package |
| --- | --- | --- |
| Chrome | `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chrome` | `dist/slyfox-chrome-<version>.zip` |
| Edge | `edge://extensions` → Developer mode → **Load unpacked** → `dist/edge` | `dist/slyfox-edge-<version>.zip` |
| Opera | `opera://extensions` → Developer mode → **Load unpacked** → `dist/opera` | `dist/slyfox-opera-<version>.zip` |
| Firefox 140+ | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/firefox/manifest.json` | `dist/slyfox-firefox-<version>.zip` |
| Safari | `npm run build:safari` (needs Xcode), open the built app, then Safari → Develop → **Allow Unsigned Extensions** and enable Slyfox in Settings → Extensions | Archive and submit the Xcode project in `dist/safari-xcode` |

Then open the extension's settings, paste your Sarvam API key, pick a model and reasoning level, and save. Slyfox checks the key and model before saving. In Firefox, saving also asks for permission to reach `api.sarvam.ai`.

## Use it

Open a terms page and click the Slyfox toolbar button. A panel opens on the right. Click a quote to scroll to it and highlight it on the page. Click the button again, or the ×, to close the panel. Navigating to another page removes it.

## How it works

| Step | Where | File |
| --- | --- | --- |
| Extract visible text into numbered segments | Page | `src/content/content.js` |
| Scrub PII (email, phone, card, Aadhaar, PAN, IFSC, IP) | Background | `src/lib/scrub.js` |
| Character and token limits | Background | `src/lib/budget.js` |
| Screen for prompt injection, then analyze | Background → Sarvam | `src/lib/pipeline.js`, `src/lib/prompts.js`, `src/lib/sarvam.js` |
| Drop any quote not found in its segment | Background | `src/lib/verify.js` |
| Render the panel and highlights | Page | `src/content/content.js` |

The API key is stored in `storage.local` and read only by the background worker and the settings page. Model output only enters the page as text nodes.

## Test

```bash
npm test
```

Uses Node's built-in test runner, no dependencies. To lint the Firefox build the way the store does: `npx web-ext lint --source-dir dist/firefox`. For a manual check, serve the folder (`python3 -m http.server`) and open `test/fixtures/terms.html`: it contains hidden injection text, a collapsed section, and fake personal details.

## Releases

Every push to `main` runs the tests, builds the store packages, lints the Firefox build, and publishes a GitHub release tagged `v<version>-build.<run number>` with the Chrome, Edge, Opera and Firefox zips attached ([.github/workflows/release.yml](.github/workflows/release.yml)). Bump `version` in `manifest.json` for a new store version. Safari isn't built in CI because it needs Xcode and signing.
