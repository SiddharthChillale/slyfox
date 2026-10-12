# Contributing to Slyfox

Thanks for helping. Bug reports, new catches to look for, and pull requests are all welcome.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach before you write the code.

## Set up

You need Node 22.18 or newer and pnpm.

```bash
pnpm install
pnpm build
```

Load `dist/<browser>` as an unpacked extension (see the table in the [README](README.md#install-from-source)) and add your Sarvam API key in the extension's settings.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Make the change. Keep it focused: one fix or feature per pull request.
3. Add or update tests in `test/` for anything in `src/lib/`. The tests run straight from TypeScript with Node's built-in runner.
4. Run the checks CI runs:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm lint:firefox
   ```

5. Open a pull request and fill in the template.

## Code notes

- Source files import each other with `.ts` extensions so Node can run them directly; the compiler rewrites them to `.js`.
- `src/content/content.ts` is injected with `scripting.executeScript`, so it must compile to a classic script with no imports. Shared types live in the ambient `src/types.d.ts`.
- Treat page text and model output as untrusted. Page text is wrapped as data in prompts, and model output only reaches the page as text nodes. Keep it that way.
- Nothing leaves the extension before PII scrubbing (`src/lib/scrub.ts`). New code that sends text anywhere must go through the same path.
- Adding a model means adding a row to `src/lib/models.ts`. Adding a catch means adding an item to `CHECKLIST` in `src/lib/prompts.ts`.

## Manual testing

Serve the repo (`python3 -m http.server`) and open `test/fixtures/terms.html`. It contains hidden injection text, a collapsed section, and fake personal details, so you can check screening, extraction and scrubbing in one place.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
