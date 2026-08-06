// Stable article identity derived from a URL.
//
// Both news sites put a real article ID in the path, so two teasers that link
// the same article through different URLs (tracking params, http vs https,
// www vs bare host, a Kauppalehti cross-link) collapse onto one identity:
//
//   https://www.is.fi/viihde/art-2000012186173.html                 -> is:2000012186173
//   https://www.iltalehti.fi/tv-ja-leffat/a/1ee556a4-…-88b5870f4330 -> a:1ee556a4-…-88b5870f4330
//
// Anything else falls back to a UUIDv5 of the normalized URL in the RFC 9562
// URL namespace (`6ba7b811-9dad-11d1-80b4-00c04fd430c8`) — deterministic, so
// the same URL always yields the same key, on any machine.
//
// Loaded both as a classic content script and (via `import`) by the module
// service worker, so it follows extractors.js: an IIFE hanging its API off
// globalThis rather than using ES exports.

(function () {
  // RFC 9562 §6.6 (RFC 4122 App. C) — the URL namespace. It is named
  // NAMESPACE_URL, though it is the namespace for URIs generally.
  const UUID_NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

  // Article-ID patterns, matched against the *path*. Deliberately stricter than
  // content.js's ARTICLE_PATTERNS: that one decides "does this link look like
  // an article at all" and wants recall, this one must extract an exact ID or
  // admit it cannot. A near-miss here just means the UUIDv5 fallback is used.
  const ID_PATTERNS = [
    // Ilta-Sanomat / is.fi:  /viihde/art-2000012186173.html
    { re: /\/art-(\d+)\.html$/, tag: 'is' },
    // Iltalehti / Kauppalehti (shared Alma CMS):  /<section>/a/<uuid>
    {
      re: /\/a\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i,
      tag: 'a',
    },
  ];

  // Params that never change which article you land on.
  const TRACKING_PARAM = /^(utm_|at_)|^(fbclid|gclid|igshid|ref|shareid|share|xtor)$/i;

  // Canonical form of a URL for hashing: https, lowercased bare host, no
  // fragment, no tracking params, remaining params sorted, no trailing slash.
  function normalizeUrl(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return String(raw || '').trim();
    }
    u.hash = '';
    if (u.protocol === 'http:') u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const kept = Array.from(u.searchParams.entries())
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    u.search = kept.length
      ? '?' + kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.href;
  }

  // The site's own article ID, or null when the URL carries none. Synchronous —
  // callers that must not await (per-page dedupe) rely on that.
  function articleIdFromUrl(raw) {
    if (!raw) return null;
    let path = String(raw);
    try {
      path = new URL(raw, 'https://invalid.example').pathname;
    } catch {
      /* not parseable — match against the raw string */
    }
    for (const { re, tag } of ID_PATTERNS) {
      const m = re.exec(path);
      if (m) return `${tag}:${m[1].toLowerCase()}`;
    }
    return null;
  }

  function uuidToBytes(uuid) {
    const hex = uuid.replace(/-/g, '');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function bytesToUuid(b) {
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  // RFC 9562 §5.5: UUIDv5 = SHA-1(namespace bytes || name), first 16 bytes,
  // with the version and variant bits overwritten.
  async function uuidv5(name, namespace = UUID_NAMESPACE_URL) {
    const ns = uuidToBytes(namespace);
    const nm = new TextEncoder().encode(name);
    const buf = new Uint8Array(ns.length + nm.length);
    buf.set(ns, 0);
    buf.set(nm, ns.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
    const out = digest.slice(0, 16);
    out[6] = (out[6] & 0x0f) | 0x50; // version 5
    out[8] = (out[8] & 0x3f) | 0x80; // variant 10xx
    return bytesToUuid(out);
  }

  // The cache identity for an article URL. Never null: falls back to UUIDv5.
  // Tagged (`is:` / `a:` / `u5:`) so a hashed key can never be mistaken for a
  // real Alma UUID.
  async function articleKey(url) {
    return articleIdFromUrl(url) || 'u5:' + (await uuidv5(normalizeUrl(url)));
  }

  // Fingerprint of the text the model actually sees. A generated headline is a
  // pure function of its prompt inputs, so this is what decides whether a cached
  // headline is still valid — not a transport validator. (Measured on live
  // articles: is.fi rotates its ETag on content that never changed, and
  // iltalehti.fi sends no validator at all, while this extracted text held byte-
  // stable across every sample.) Whitespace is collapsed first so reflowed
  // markup alone can't look like an edit.
  async function contentHash(text) {
    const norm = String(text || '').replace(/\s+/g, ' ').trim();
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm)),
    );
    return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  globalThis.KlikintappajaIds = {
    articleIdFromUrl,
    articleKey,
    contentHash,
    normalizeUrl,
    uuidv5,
    UUID_NAMESPACE_URL,
  };
})();
