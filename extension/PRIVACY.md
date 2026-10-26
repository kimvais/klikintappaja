# Klikintappaja — Privacy Policy

_Last updated: 2026-10-25_

> Suomeksi: [PRIVACY-fi.md](PRIVACY-fi.md). This English version is the
> authoritative one if the two ever disagree.

Klikintappaja is a browser extension that replaces clickbait headlines on Finnish
news sites with factual ones. It collects **no analytics and no telemetry**, and
nothing is sold or shared for advertising. **There is no server operated by us**:
everything runs in your browser, with your own AI provider API key.

## What leaves your browser

- **API key.** The key you enter for Google Gemini, Anthropic Claude or OpenAI,
  or the one OpenRouter issues when you sign in there, is stored locally via
  `chrome.storage.local`. It never leaves your browser except in requests to
  that provider.
- **OpenRouter sign-in.** If you choose *Kirjaudu OpenRouteriin*, the sign-in
  happens on OpenRouter's own site; the extension never sees your password. It
  receives only an API key for your OpenRouter account.
- **Article text.** To rewrite a headline the extension fetches the linked
  article and sends its text plus the original headline to the provider you
  chose. It is processed under that provider's terms:
  [OpenRouter](https://openrouter.ai/privacy),
  [Gemini](https://ai.google.dev/terms),
  [Anthropic](https://www.anthropic.com/legal/privacy),
  [OpenAI](https://openai.com/policies/privacy-policy). OpenRouter passes the
  request on to the company behind the model you use (by default Anthropic), so
  with OpenRouter both see the text. With **Ollama** the model runs on your own
  computer (`localhost`) and the article text does not leave it at all.
- **News-site cookies.** Article fetches carry **your existing cookies for that
  news site** (is.fi, iltasanomat.fi, iltalehti.fi, kauppalehti.fi), exactly as
  if you opened the article yourself. This is what lets a paying IS Extra or
  Iltalehti Plus subscriber get a real headline instead of a paywall
  placeholder. Those cookies go only to the news site — never to an AI provider,
  never to us. The consequence: if you are a subscriber, the text sent to your AI
  provider is subscriber-only content. Setting **Maksumuurin takana** to
  *Häivytä* or *Piilota kokonaan* means locked articles are never sent anywhere.

## Local storage

**Cached headlines** live in `chrome.storage.local`, keyed by article ID and
validated against a hash of the article text, and expire after 24 hours. The
cache holds headlines and hashes, **not article text**. Clear it any time from
the popup with **Tyhjennä välimuisti**.

## What we do not do

- No server and no accounts of ours.
- No analytics, telemetry or browsing history collection.
- No advertising, no profiling, no selling or sharing of data.

## Source code

The extension is open source under the MIT licence, so every claim here can be
checked against the code: https://github.com/kimvais/klikintappaja

## Contact

Open an issue on the project's GitHub repository.
