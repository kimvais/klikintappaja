# Klikintappaja — a de-clickbait Chrome extension for IS & IL

Replaces clickbait headlines (*klikkiotsikot*) on **iltalehti.fi** and
**iltasanomat.fi / is.fi** with factual, LLM-generated ones — in place, as you
scroll. The name is a wink at *klikinsäästäjä* (the click *saver*) — this one is
the click *killer*.

It reuses the anti-clickbait prompt and the per-site article extractors from the
[`uutis`](../README.md) project (see `src/uutis/prompts.py` and
`src/uutis/crawler/sources/fi.py`). Fully client-side: your own API key, no
backend, no data leaves the browser except the article text sent to the LLM.

## How it works

1. On a front page, the content script finds headline links.
2. As each scrolls into view it fetches the linked article (same origin, so no
   CORS), extracts the body, and asks the background worker to rewrite the
   headline from the **actual article content** (never from the clickbait title
   alone).
3. While a headline is being killed, a spinning 💀 badge trails it; once the
   factual headline is swapped in, the badge turns into a subtle ✨. Hover the
   headline to see the original clickbait title.
4. Results are cached for 24h keyed by the **article ID** in the URL
   (`art-2000012186173` → `is:2000012186173`, `/a/<uuid>` → `a:<uuid>`; anything
   else falls back to a UUIDv5 of the normalized URL). Tracking params, `www.`
   and cross-site links to the same article all share one entry, so revisits —
   and the same story teased twice on a page — are instant and free.
5. A cached headline is reused only while the **SHA-256 of the extracted article
   body** (plus the provider and model) is unchanged, so a *developing story*
   that gets rewritten gets a fresh headline instead of a stale one. Site
   `ETag`s are deliberately not used for this: Iltalehti sends none, and IS
   rotates its ETag on articles that have not changed.

## Install (load unpacked)

1. Run `pwsh ./build.ps1` from the repo root (or grab `klikintappaja-extension.zip`)
   and unzip it — or just point Chrome at the `extension/` folder directly.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the folder (the one with `manifest.json`).
4. Open the popup, pick a **provider**, paste your **API key**, **Tallenna** (Save).

### Providers (bring your own key)

| Provider | Get a key | Default model |
| --- | --- | --- |
| Google Gemini | https://aistudio.google.com/apikey | `gemini-2.5-flash-lite` |
| Anthropic Claude | https://console.anthropic.com | `claude-haiku-4-5` |
| OpenAI ChatGPT | https://platform.openai.com/api-keys | `gpt-4o-mini` |

Keys are stored per-provider in `chrome.storage.local` and never leave the browser
except in the request to the provider you selected.

## Use

Visit https://www.iltalehti.fi/ or https://www.is.fi/. Headlines near the top of
the page are rewritten within a few seconds; scrolling triggers more. Toggle the
extension on/off or clear the cache from the popup.

## Notes & limitations

- **Front-page selectors are heuristic.** Headline links are detected by their
  article-URL pattern (`/art-<id>.html` for IS, `/a/<id>` for IL) plus their link
  text length. If the sites restructure their front pages, adjust
  `ARTICLE_PATTERNS` in `content.js`.
- On any failure (no key, fetch error, thin article body, LLM error) the original
  headline is left untouched.
- Providers live in a small registry (`PROVIDERS`) in `background.js`. Adding a
  future **hosted / shared-API** provider — so users don't each need a key — is
  one more entry there; no other code changes.
- Cost is tiny with the default fast models (~0.5–1.5k input tokens/article), and
  the 24h per-URL cache avoids repeat calls.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest (matches, permissions, worker, popup) |
| `content.js` | headline detection, lazy fetch+extract, text swap |
| `extractors.js` | per-site body extraction (ported from `fi.py`) |
| `articleid.js` | article ID from the URL (`is:`/`a:`, UUIDv5 fallback) — the cache key |
| `prompts.js` | anti-clickbait prompt (ported from `prompts.py`) |
| `background.js` | provider registry (Gemini/Claude/OpenAI) + per-URL cache |
| `popup.html` / `popup.js` | provider, API key, model, toggle, counter, clear cache |

Build the distributable zip with `build.ps1` (repo root).

## License

[MIT](LICENSE) © 2026 Kimmo Parviainen-Jalanko.
