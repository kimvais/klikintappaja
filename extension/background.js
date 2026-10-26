// Klikintappaja background service worker (MV3, module).
// Holds the user's API key, calls the chosen LLM provider, and caches results
// by article ID. The content script never sees the key or talks to the LLM.
//
// Provider abstraction: each entry knows its default model and how to turn
// (system, prompt) into a headline string.
//
// Everything runs here, for one reader, with that reader's own key — never on a
// server of ours. Sanoma and Alma Media prohibit using their content for AI, so
// a hosted service would be us doing exactly that; a per-user client is the
// equivalent of a screen reader. Do not add a hosted or shared mode.

import { SYSTEM_INSTRUCTION, HARDCORE_FINNISH, buildHeadlinePrompt } from './prompts.js';
// articleid.js is a classic script (it is also injected as a content script, and
// content scripts can't be modules), so it is imported for its side effect and
// read off globalThis — same arrangement as extractors.js on the content side.
import './articleid.js';

const { articleKey, contentHash } = globalThis.KlikintappajaIds;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// 1 = URL-keyed, no content hash; 2 = before LENGTH_RULE. Bump whenever the
// prompt changes: the cache is valid only while every input to the headline is.
const CACHE_VERSION = 3;
const MAX_OUT_CHARS = 300;
// Generous enough that gemini-3.x's default-level thinking doesn't crowd out
// the headline itself — see the MAX_TOKENS finishReason check in the gemini
// provider below, which catches it if this still isn't enough.
const MAX_TOKENS = 1200;
const OLLAMA_URL = 'http://localhost:11434';

function retryable(status) {
  return status === 429 || status >= 500;
}

async function readJson(res) {
  return res.json();
}

// --- providers -------------------------------------------------------------

const PROVIDERS = {
  // First, so it is what a new user sees: the key comes from signing in
  // (connectOpenRouter), not from pasting one. Still the user's own account and
  // credits — OpenRouter only routes the call to the model's provider.
  openrouter: {
    label: 'OpenRouter (kirjaudu)',
    defaultModel: 'anthropic/claude-haiku-5.5', // cheapest capable model there
    keyHint: 'sk-or-…  (saat avaimen kirjautumalla)',
    async call({ apiKey, model, system, prompt }) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Title': 'Klikintappaja', // app attribution on OpenRouter's side
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
      if (!res.ok) throwHttp(res.status, 'openrouter');
      const data = await readJson(res);
      return data?.choices?.[0]?.message?.content || '';
    },
  },

  // Runs on the user's own machine: no account, no key, no cost, and the
  // article text never leaves the computer. Ollama 0.40.8 accepts
  // chrome-extension:// origins by default (measured); an Ollama that refuses
  // them answers 403, hence the dedicated message.
  ollama: {
    label: 'Ollama (oma kone)',
    defaultModel: 'gemma4:e4b', // Gemma handles Finnish far better than Qwen at this size
    needsKey: false,
    async call({ model, system, prompt }) {
      // The native endpoint, not /v1: it returns a thinking model's reasoning in
      // a separate field, so `content` is only the answer.
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          // Gemma 4 thinks by default: measured 65 s for one headline with it,
          // 0.5–0.8 s without, and the headlines were no worse.
          think: false,
          options: { temperature: 0, num_predict: MAX_TOKENS },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (res.status === 403) throw new Error('ollama 403: update Ollama or set OLLAMA_ORIGINS=chrome-extension://*');
      if (!res.ok) throwHttp(res.status, 'ollama');
      const data = await readJson(res);
      return data?.message?.content || '';
    },
  },

  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.5-flash', // 2.5-flash-lite started 404ing for new API keys
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
          // No thinkingConfig override: forcing thinkingLevel 'minimal' made
          // gemini-3.5-flash cut the headline itself short (e.g. "Eduskunnan
          // puhemies J") even with finishReason STOP, not just MAX_TOKENS —
          // composing a new headline from the article apparently needs more
          // reasoning room than 'minimal' leaves it. maxOutputTokens is generous
          // instead, so the model's own (default-level) thinking doesn't have to
          // compete with the answer for budget.
          generationConfig: { temperature: 0, maxOutputTokens: MAX_TOKENS },
        }),
      });
      if (!res.ok) throwHttp(res.status, 'gemini');
      const data = await readJson(res);
      const candidate = data?.candidates?.[0];
      // A MAX_TOKENS finish means the budget ran out — possibly mid-word — before
      // the model finished; the thinking-token share varies per request, so this
      // is reached occasionally even with the generous budget. Treat it as
      // retryable rather than returning a truncated headline.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        const err = new Error('gemini MAX_TOKENS');
        err.retryable = true;
        throw err;
      }
      // Thinking models can return thought-summary parts alongside the real
      // answer (flagged `thought: true` on the part); joining those in would
      // splice reasoning fragments into the headline text.
      const parts = (candidate?.content?.parts || []).filter((p) => !p.thought);
      return parts.map((p) => p.text || '').join('') || '';
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

const DEFAULT_PROVIDER = 'openrouter';
// Users of the pre-multi-provider popup stored a bare Gemini key as `apiKey`
// and never stored a provider at all.
const LEGACY_PROVIDER = 'gemini';

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
    provider: null,
    keys: {},
    models: {},
    apiKey: '', // legacy flat fields (pre-multi-provider popup)
    model: '',
  });
  const provider = PROVIDERS[cfg.provider]
    ? cfg.provider
    : cfg.apiKey
      ? LEGACY_PROVIDER
      : DEFAULT_PROVIDER;
  // Fall back to the legacy flat key/model if nothing is stored per-provider —
  // a key saved by the older popup lived under `apiKey`, not `keys.gemini`.
  const apiKey =
    (cfg.keys && cfg.keys[provider]) || (provider === LEGACY_PROVIDER && cfg.apiKey) || '';
  const model =
    (cfg.models && cfg.models[provider]) ||
    (provider === LEGACY_PROVIDER && cfg.model) ||
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

async function handleRewrite({ url, originalHeadline, body, mod }) {
  const id = await articleKey(url);
  const sha = await contentHash(body);
  // Config is read before the cache check (it is key-independent) because the
  // provider/model are part of what makes an entry valid.
  const { provider, apiKey, model } = await getConfig();

  const cached = await readCache(id, { sha, provider, model });
  if (cached) return { headline: cached };

  if (!apiKey && PROVIDERS[provider].needsKey !== false) return { error: 'no-api-key' };

  const headline = await generateHeadline({ provider, apiKey, model, originalHeadline, body });
  if (!headline) return { error: 'empty-output' };

  await writeCache(id, { headline, sha, mod, provider, model, original: originalHeadline });
  return { headline };
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

// --- OpenRouter sign-in ------------------------------------------------------

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// OAuth PKCE (https://openrouter.ai/docs/use-cases/oauth-pkce): the user signs
// in at OpenRouter and approves, and we receive an API key issued to *their*
// account. Runs in the worker, not the popup, because the popup closes as soon
// as the sign-in window takes focus.
async function connectOpenRouter() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const auth = new URL('https://openrouter.ai/auth');
  auth.search = new URLSearchParams({
    callback_url: chrome.identity.getRedirectURL('openrouter'),
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    key_label: 'Klikintappaja',
    state,
  });
  const redirect = new URL(
    await chrome.identity.launchWebAuthFlow({ url: auth.href, interactive: true })
  );
  // Fail closed: a callback carrying someone else's state is not ours to use.
  if (redirect.searchParams.get('state') !== state) throw new Error('state mismatch');
  const code = redirect.searchParams.get('code');
  if (!code) throw new Error('no code in callback');

  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`openrouter key exchange ${res.status}`);
  const { key } = await readJson(res);
  if (!key) throw new Error('openrouter returned no key');

  const { keys = {} } = await chrome.storage.local.get({ keys: {} });
  await chrome.storage.local.set({ keys: { ...keys, openrouter: key }, provider: 'openrouter' });
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
    out[id] = {
      label: p.label,
      defaultModel: p.defaultModel,
      keyHint: p.keyHint,
      needsKey: p.needsKey !== false,
    };
  }
  return out;
}

chrome.runtime.onInstalled.addListener((details) => {
  pruneCache().catch(() => {});
  // Only on a genuine first install — not on every update, and not when Chrome
  // itself updates. A new user otherwise has no idea a key is needed.
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
  if (msg.type === 'providers') {
    // `active` is what getConfig() resolves to, so the popup shows the provider
    // that is actually in use (a legacy-key user's is not the default).
    getConfig().then(({ provider }) =>
      sendResponse({ providers: providerInfo(), default: DEFAULT_PROVIDER, active: provider })
    );
    return true;
  }
  if (msg.type === 'connectOpenRouter') {
    connectOpenRouter()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  return false;
});
