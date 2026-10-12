# Privacy

Slyfox has no server and collects nothing. This page says exactly where your data goes.

## What stays on your device

- Your Sarvam API key, model choice and settings, saved in the browser's extension storage (`storage.local`).
- Your Langfuse keys, if you turn tracing on.
- The text of the page, until you click the Slyfox button.

## What leaves your device, and only when you click the button

- **To Sarvam AI (`api.sarvam.ai`)**: the visible text of the current page, after Slyfox has removed email addresses, phone numbers, card numbers, Aadhaar and PAN numbers, IFSC codes and IP addresses. It's sent with your own API key, under [Sarvam's terms](https://www.sarvam.ai).
- **To your Langfuse host, only if you turned tracing on**: timings, counts and errors for each run. If you also leave **Include prompts, responses and the page address** ticked, the scrubbed page text, the model's replies and the page URL are included. Your Sarvam key is never sent.

Nothing is sent to the Slyfox developers. There is no analytics, telemetry or crash reporting.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you clicked the button on, and only that page |
| `scripting` | Inject the script that extracts the text and draws the panel |
| `storage` | Save your settings and keys locally |
| `https://api.sarvam.ai/*` | Send the analysis request |
| Optional host access | Asked for only when you set a Langfuse host |

## Removing your data

Uninstalling the extension deletes everything it stored.
