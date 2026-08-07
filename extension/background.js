// Klikintappaja background service worker (MV3, module).
// Holds the user's API key, calls the chosen LLM provider, and caches results
// by article ID. The content script never sees the key or talks to the LLM.
//
// Provider abstraction: each entry knows its default model and how to turn
// (system, prompt) into a headline string. Adding a hosted/shared-API provider
// later (so users don't need their own key) is just one more entry here — the
// "shared API pivot" the project is heading toward, without a backend today.

import { SYSTEM_INSTRUCTION, HARDCORE_FINNISH, buildHeadlinePrompt } from './prompts.js';
// articleid.js is a classic script (it is also injected as a content script, and
// content scripts can't be modules), so it is imported for its side effect and
// read off globalThis — same arrangement as extractors.js on the content side.
import './articleid.js';
import * as hosted from './hosted.js';

const { articleKey, contentHash } = globalThis.KlikintappajaIds;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_VERSION = 2; // 1 = URL-keyed, no content hash
const MAX_OUT_CHARS = 300;
const MAX_TOKENS = 200;

function retryable(status) {
  return status === 429 || status >= 500;
}

async function readJson(res) {
  return res.json();
}

// --- providers -------------------------------------------------------------

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash-lite', // matches uutis settings.py:CHAT_MODEL
    keyHint: 'AIza…  (aistudio.google.com/apikey)',
    async call({ apiKey, model, system, prompt }) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: MAX_TOKENS },
        }),
      });
      if (!res.ok) throwHttp(res.status, 'gemini');
      const data = await readJson(res);
      const parts = data?.candidates?.[0]?.content?.parts;
      return parts?.map((p) => p.text || '').join('') || '';
    },
  },

  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-haiku-4-5', // fast + cheap; good for short rewrites
    keyHint: 'sk-ant-…  (console.anthropic.com)',
    async call({ apiKey, model, system, prompt }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // Allow the call from a browser/extension context.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throwHttp(res.status, 'anthropic');
      const data = await readJson(res);
      const parts = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text);
      return parts.join('');
    },
  },

  openai: {
    label: 'OpenAI ChatGPT',
    defaultModel: 'gpt-4o-mini',
    keyHint: 'sk-…  (platform.openai.com/api-keys)',
    async call({ apiKey, model, system, prompt }) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) throwHttp(res.status, 'openai');
      const data = await readJson(res);
      return data?.choices?.[0]?.message?.content || '';
    },
  },
};

const DEFAULT_PROVIDER = 'gemini';

function throwHttp(status, provider) {
  const err = new Error(`${provider} ${status}`);
  err.status = status;
  err.retryable = retryable(status);
  throw err;
}

// --- config + cache --------------------------------------------------------

// Keyed by article ID rather than URL, so the same article reached through a
// different teaser link (tracking params, cross-site KL link, http/www variant)
// is one cache entry instead of several.
function cacheKey(id) {
  return 'cache:' + id;
}

async function getConfig() {
  const cfg = await chrome.storage.local.get({
    provider: DEFAULT_PROVIDER,
    keys: {},
    models: {},
    apiKey: '', // legacy flat fields (pre-multi-provider popup)
    model: '',
  });
  const provider = PROVIDERS[cfg.provider] ? cfg.provider : DEFAULT_PROVIDER;
  // Fall back to the legacy flat key/model if nothing is stored per-provider —
  // a key saved by the older popup lived under `apiKey`, not `keys.gemini`.
  const apiKey = (cfg.keys && cfg.keys[provider]) || cfg.apiKey || '';
  const model =
    (cfg.models && cfg.models[provider]) ||
    (provider === DEFAULT_PROVIDER && cfg.model) ||
    PROVIDERS[provider].defaultModel;
  return { provider, apiKey, model };
}

// A cached headline stays valid only while every input that produced it is
// unchanged. The generated headline is a pure function of (body text, system
// prompt, provider, model) — the body is the only part of the page the model
// ever sees — so hashing the extracted body is both necessary and sufficient to
// catch a developing story being rewritten. Transport validators are not used
// on purpose: measured against live articles, is.fi rotates its ETag on
// unchanged content (3 values in 2.5 min on a hot story) and iltalehti.fi sends
// none at all.
async function readCache(id, { sha, provider, model }) {
  const key = cacheKey(id);
  const got = await chrome.storage.local.get(key);
  const entry = got[key];
  if (!entry || entry.v !== CACHE_VERSION) return null;
  if (Date.now() - entry.ts >= CACHE_TTL_MS) return null;
  if (entry.sha !== sha) return null; // article was edited -> regenerate
  if (entry.provider !== provider || entry.model !== model) return null;
  return entry.headline;
}

// `mod` (the article's own dateModified) and `original` (the front-page
// clickbait this was generated from) are recorded as hints for debugging and
// for future use — deliberately NOT part of the validity check above. `mod`
// can't add anything: an edit that leaves the extracted body identical cannot
// change the model's output, so acting on it would only buy duplicate work.
// `original` is a genuine prompt input, but folding it in would make the same
// article teased twice on one page (carousel + list, different teaser text)
// invalidate its own entry on every load; sharing one generation across
// placements is both cheaper and what we want.
async function writeCache(id, { headline, sha, mod, provider, model, original }) {
  await chrome.storage.local.set({
    [cacheKey(id)]: {
      v: CACHE_VERSION,
      headline,
      sha,
      mod: mod || null,
      provider,
      model,
      original: original || null,
      ts: Date.now(),
    },
  });
}

// Housekeeping on install/startup: entries only ever expired logically, so drop
// the stale ones — plus any left over from when keys were full URLs, which no
// lookup can ever hit again.
async function pruneCache() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const dead = Object.keys(all).filter((k) => {
    if (!k.startsWith('cache:')) return false;
    if (k.includes('://')) return true; // pre-article-ID key
    const entry = all[k];
    if (!entry || typeof entry.ts !== 'number') return true;
    if (entry.v !== CACHE_VERSION) return true; // pre-content-hash entry
    return now - entry.ts >= CACHE_TTL_MS;
  });
  if (dead.length) await chrome.storage.local.remove(dead);
  return dead.length;
}

function sanitize(text) {
  if (!text) return null;
  let out = text.trim();
  out = out.split('\n')[0].trim(); // headline only
  out = out.replace(/^["'«»„""]+|["'«»„""]+$/g, '').trim();
  if (!out || out.length > MAX_OUT_CHARS) return null;
  return out;
}

async function generateHeadline({ provider, apiKey, model, originalHeadline, body }) {
  const call = PROVIDERS[provider].call;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let prompt = buildHeadlinePrompt({ originalHeadline, body });
    if (attempt > 0) prompt = `${prompt}\n\n${HARDCORE_FINNISH}`;
    try {
      const raw = await call({ apiKey, model, system: SYSTEM_INSTRUCTION, prompt });
      const cleaned = sanitize(raw);
      if (cleaned) return cleaned;
      // empty/oversized — retry
    } catch (err) {
      if (!err.retryable || attempt === maxAttempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

// --- message handling -------------------------------------------------------

async function handleRewrite({ url, originalHeadline, body, mod, paywalled }) {
  const id = await articleKey(url);
  const sha = await contentHash(body);
  // Config is read before the cache check (it is key-independent) because the
  // provider/model are part of what makes an entry valid.
  const { provider, apiKey, model } = await getConfig();

  const cached = await readCache(id, { sha, provider, model });
  if (cached) return { headline: cached };

  if (!apiKey) return { error: 'no-api-key' };

  const headline = await generateHeadline({ provider, apiKey, model, originalHeadline, body });
  if (!headline) return { error: 'empty-output' };

  await writeCache(id, { headline, sha, mod, provider, model, original: originalHeadline });

  // Share it, if the user opted in. Deliberately not awaited into the result:
  // a failed contribution — offline, not approved, rate-limited — must never
  // cost the user the headline they just paid to generate.
  shareHeadline({
    id,
    headline,
    body,
    originalHeadline,
    provider,
    model,
    paywalled: Boolean(paywalled),
  }).catch((err) => console.debug('[klikintappaja] share failed:', err));

  return { headline };
}

// --- hosted (shared) headlines ---------------------------------------------

// Look a headline up in the shared store. This is the whole point of the hosted
// mode: no article fetch, no LLM call, no API key — just the article ID, which
// is derivable from the front-page link alone.
async function handleLookup({ url }) {
  const id = await articleKey(url);
  const { data, error } = await hosted.lookupHeadline(id);
  if (error) return { error };
  return { headline: data.headline, sha: data.sha };
}

async function shareHeadline({ id, headline, body, originalHeadline, provider, model, paywalled }) {
  const { shareHeadlines } = await chrome.storage.local.get({ shareHeadlines: false });
  if (!shareHeadlines) return;
  if (paywalled) return; // never contribute subscriber-only text
  const { error } = await hosted.contributeHeadline(id, {
    headline,
    body,
    original_headline: originalHeadline || null,
    provider,
    model,
    paywalled: false,
  });
  if (error) console.debug('[klikintappaja] contribution rejected:', error);
}

// Fetch article HTML on behalf of the content script. The service worker can
// make cross-origin requests to any host in host_permissions (content scripts
// cannot in MV3), so this is what makes cross-site teasers work.
// Sends the user's cookies for the news site on purpose: it is what lets a
// paying IS Extra / Iltalehti Plus subscriber get the real article text (and so
// a real headline) where everyone else gets the lede and a paywall treatment.
// Cookies go only to the news site being read — never to the LLM provider — but
// note that for a subscriber the article text sent onward to their chosen
// provider is subscriber-only content. See PRIVACY.md.
async function fetchArticle(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { error: 'fetch ' + res.status };
  return { html: await res.text() };
}

async function incrementCount() {
  const { count = 0 } = await chrome.storage.local.get({ count: 0 });
  await chrome.storage.local.set({ count: count + 1 });
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('cache:'));
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ count: 0 });
  return keys.length;
}

// Expose provider metadata to the popup (labels, default models, key hints).
function providerInfo() {
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    out[id] = { label: p.label, defaultModel: p.defaultModel, keyHint: p.keyHint };
  }
  return out;
}

chrome.runtime.onInstalled.addListener((details) => {
  pruneCache().catch(() => {});
  // Only on a genuine first install — not on every update, and not when Chrome
  // itself updates. A new user otherwise has no idea a choice exists between
  // signing in and bringing their own key.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => {
  pruneCache().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  if (msg.type === 'fetchArticle') {
    fetchArticle(msg.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true; // async
  }
  if (msg.type === 'rewrite') {
    handleRewrite(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true; // async
  }
  if (msg.type === 'increment') {
    incrementCount().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'clearCache') {
    clearCache().then((n) => sendResponse({ cleared: n }));
    return true;
  }
  if (msg.type === 'lookup') {
    handleLookup(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true; // async
  }
  if (msg.type === 'providers') {
    sendResponse({ providers: providerInfo(), default: DEFAULT_PROVIDER });
    return false;
  }
  if (msg.type === 'signIn') {
    hosted
      .signIn()
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (msg.type === 'signOut') {
    hosted.signOut().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'authStatus') {
    // `whoami` also tells the user their pseudonymous key, which is what they
    // must quote to be approved as a contributor.
    hosted
      .isSignedIn()
      .then(async (signedIn) => {
        if (!signedIn) return { signedIn: false, configured: hosted.isConfigured() };
        const { data, error } = await hosted.whoami();
        return {
          signedIn: true,
          configured: hosted.isConfigured(),
          userKey: data ? data.user_key : null,
          contributor: Boolean(data && data.contributor),
          // Reported separately from `error`: being signed in with the API
          // unreachable is a different situation from failing to sign in, and
          // conflating them sends you debugging the wrong half.
          apiError: error || null,
        };
      })
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  return false;
});
