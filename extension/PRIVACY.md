# Klikintappaja — Privacy Policy

_Last updated: 2026-08-06_

Klikintappaja is a browser extension that rewrites clickbait headlines on
Finnish news sites into factual ones. It has **no backend server operated by
us** and collects **no analytics**.

## What data is processed

- **API key** — the key you enter for your chosen AI provider (Google Gemini,
  Anthropic Claude, or OpenAI) is stored locally in your browser via
  `chrome.storage.local`. It never leaves your browser except in the requests
  the extension makes directly to that provider's API.
- **Article text** — to rewrite a headline, the extension fetches the linked
  article and sends its text and the original headline to the AI provider you
  selected. This is the only content transmitted, and only to that provider.
- **Local cache** — rewritten headlines are cached in `chrome.storage.local`
  for 24 hours (keyed by article URL) to avoid repeat calls. You can clear it
  any time from the extension popup.

## What we do NOT do

- We do not operate a server; no data is sent to the extension's authors.
- We do not collect analytics, telemetry, browsing history, or personal data.
- We do not sell or share any data with third parties.

## Third-party processing

Article text you send is processed by the AI provider you choose, under that
provider's terms and privacy policy:

- Google Gemini — https://ai.google.dev/terms
- Anthropic Claude — https://www.anthropic.com/legal/privacy
- OpenAI — https://openai.com/policies/privacy-policy

## Contact

Open an issue on the project's GitHub repository.
