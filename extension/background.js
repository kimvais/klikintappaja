// Klikintappaja background service worker (MV3, module).
// Holds the user's API key, calls the chosen LLM provider, and caches results
// by article URL. The content script never sees the key or talks to the LLM.
//
// Provider abstraction: each entry knows its default model and how to turn
// (system, prompt) into a headline string. Adding a hosted/shared-API provider
// later (so users don't need their own key) is just one more entry here — the
// "shared API pivot" the project is heading toward, without a backend today.

import { SYSTEM_INSTRUCTION, HARDCORE_FINNISH, buildHeadlinePrompt } from './prompts.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
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

function cacheKey(url) {
  return 'cache:' + url;
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

async function readCache(url) {
  const key = cacheKey(url);
  const got = await chrome.storage.local.get(key);
  const entry = got[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.headline;
  return null;
}

async function writeCache(url, headline) {
  await chrome.storage.local.set({ [cacheKey(url)]: { headline, ts: Date.now() } });
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

async function handleRewrite({ url, originalHeadline, body }) {
  const cached = await readCache(url);
  if (cached) return { headline: cached };

  const { provider, apiKey, model } = await getConfig();
  if (!apiKey) return { error: 'no-api-key' };

  const headline = await generateHeadline({ provider, apiKey, model, originalHeadline, body });
  if (!headline) return { error: 'empty-output' };

  await writeCache(url, headline);
  return { headline };
}

// Fetch article HTML on behalf of the content script. The service worker can
// make cross-origin requests to any host in host_permissions (content scripts
// cannot in MV3), so this is what makes cross-site teasers work.
async function fetchArticle(url) {
  const res = await fetch(url, { credentials: 'omit' });
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
    sendResponse({ providers: providerInfo(), default: DEFAULT_PROVIDER });
    return false;
  }
  return false;
});
