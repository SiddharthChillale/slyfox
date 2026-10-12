# Security policy

Slyfox handles your API keys and the text of the pages you analyze, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't** open a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/SiddharthChillale/slyfox/security/advisories/new) instead.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a week, and a fix or a plan once the issue is confirmed.

## In scope

- A web page getting the extension to run script, read storage, or exfiltrate data
- API keys leaking out of `storage.local`, into a page, or into Langfuse traces
- Personal details reaching Sarvam or Langfuse despite PII scrubbing
- Prompt injection that gets past the screening step and changes what the panel shows in a harmful way

## Supported versions

Only the latest release gets fixes.
