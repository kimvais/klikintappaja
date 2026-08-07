# Klikintappaja — Privacy Policy

_Last updated: 2026-08-07_

Klikintappaja is a browser extension that replaces clickbait headlines on Finnish
news sites with factual ones. It collects **no analytics and no telemetry**, and
nothing is sold or shared for advertising.

How much data leaves your browser depends entirely on which of the two modes you
choose in the popup under **Otsikoiden lähde**:

| | Own API key | Shared database |
| --- | --- | --- |
| Google sign-in | not required | **required** |
| Article text sent to | your chosen AI provider | nobody |
| Data reaching our server | none | the article ID you are looking up |

## Mode 1 — your own API key

No server operated by us is involved at all.

- **API key.** The key you enter for Google Gemini, Anthropic Claude or OpenAI is
  stored locally via `chrome.storage.local`. It never leaves your browser except
  in requests to that provider.
- **Article text.** To rewrite a headline the extension fetches the linked
  article and sends its text plus the original headline to the provider you
  chose. It is processed under that provider's terms:
  [Gemini](https://ai.google.dev/terms),
  [Anthropic](https://www.anthropic.com/legal/privacy),
  [OpenAI](https://openai.com/policies/privacy-policy).
- **News-site cookies.** Article fetches carry **your existing cookies for that
  news site** (is.fi, iltasanomat.fi, iltalehti.fi, kauppalehti.fi), exactly as
  if you opened the article yourself. This is what lets a paying IS Extra or
  Iltalehti Plus subscriber get a real headline instead of a paywall
  placeholder. Those cookies go only to the news site — never to an AI provider,
  never to us. The consequence: if you are a subscriber, the text sent to your AI
  provider is subscriber-only content. Setting **Maksumuurin takana** to
  *Häivytä* or *Piilota kokonaan* means locked articles are never sent anywhere.

## Mode 2 — shared database (Google sign-in)

Headlines are read from a store of headlines other users have already generated.
Your browser does **not** fetch the article and no AI provider is involved.

- **What we receive.** For each headline shown, your browser asks our API for one
  article ID (for example `is/2000012186173`), with a Google ID token attached.
  So the operator of the service can see that a given pseudonymous user looked up
  a given article. This is inherent to the mode; if you would rather nobody could
  observe that, use the own-API-key mode.
- **What we keep about you.** The ID token is verified and reduced to an
  irreversible HMAC of your Google account's subject identifier. **That hash is
  all that is stored** — no email address, no name, no profile picture. The
  extension requests the `openid` scope only, so we never receive those in the
  first place. The hash exists to count requests per person, because the service
  is paid for out of one person's pocket.
- **Rate-limit counters** hold that hash and a time window, and delete themselves
  automatically when the window passes.
- **Honest framing:** the hash is stable and tied to your account, so it is
  *pseudonymous* rather than anonymous data. We deliberately cannot connect it to
  an identity, but we do not claim it falls outside data-protection law.

## Sharing headlines you generate (optional, off by default)

If you use your own API key you may additionally opt in to contribute your
headlines, which requires signing in and being granted permission separately.
When enabled, a successful rewrite sends the headline **and the article text** to
our API.

**The article text is not stored.** It is used to compute a fingerprint that
identifies which version of the article the headline describes, and is then
discarded. What is kept is: the article ID, the headline, that fingerprint, the
provider and model that produced it, your pseudonymous key, and a timestamp.

Headlines derived from paywalled articles are never contributed — the extension
refuses to send them and the server refuses to accept them.

## Local storage

- **Cached headlines** live in `chrome.storage.local`, keyed by article ID and
  validated against a hash of the article text, and expire after 24 hours. The
  cache holds headlines and hashes, **not article text**. Clear it any time from
  the popup.
- **Your sign-in token** is stored locally and removed when you sign out.

## Retention and removal

- Local cache: 24 hours, or immediately via **Tyhjennä välimuisti**.
- Sign-in: revoked locally by signing out; you can also remove the app's access
  from your [Google account permissions](https://myaccount.google.com/permissions).
- Shared headlines: kept indefinitely, because they are the shared resource the
  service exists to provide. They describe news articles, not people. Every entry
  records which contributor supplied it, so if you have contributed and want
  those entries removed, ask and they can be deleted.

## Where it runs

The API runs on Google Cloud Run in the EU (`europe-north1`) with data in
MongoDB Atlas. Credentials are held in Google Secret Manager. The service is
operated personally by the project's author, not by a company.

## What we do not do

- No analytics, telemetry or browsing history collection.
- No advertising, no profiling, no selling or sharing of data.
- No storage of article text on our server.
- No collection of your email address or name.

## Source code

The extension and the server are open source under the MIT licence, so every
claim here can be checked against the code:
https://github.com/kimvais/klikintappaja

## Contact

Open an issue on the project's GitHub repository.
