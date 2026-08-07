// Klikintappaja content script.
// Runs on is.fi / iltasanomat.fi / iltalehti.fi. Finds headline elements,
// lazily (as they scroll into view) fetches the linked article SAME-ORIGIN,
// extracts its body, asks the background worker to rewrite the headline, and
// swaps the text in place — preserving all site markup/styling. The clickbait
// original is kept in a tooltip.

(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-klikintappaja-state'; // pending | done | skip
  const MAX_CONCURRENCY = 3;
  const MIN_HEADLINE_LEN = 15;
  const MAX_HEADLINE_LEN = 220;
  const CARD_LOOKUP_HOPS = 4; // ancestors to search for an article link
  const TEASER_LOOKUP_HOPS = 4; // ancestors to consider as "this one teaser"
  const PAYWALL_MODES = ['off', 'dim', 'hide'];

  // Article-URL patterns per host (used to tell headline links from nav/ads).
  const ARTICLE_PATTERNS = [
    /\/art-\d+\.html/, // is.fi / iltasanomat.fi
    /\/a\/[0-9a-f][0-9a-f-]{5,}/i, // iltalehti.fi  (/<section>/a/<uuid>)
  ];

  let enabled = true;
  let mode = 'key'; // key (own API key) | hosted (shared store, Google sign-in)
  let paywallMode = 'dim'; // off | dim (gray + 🫰) | hide
  let inFlight = 0;
  const queue = [];
  const treated = new Set(); // {el, unit, tier} we applied a paywall treatment to
  // article id -> Promise<string|null>. Keyed by ID rather than URL so the same
  // article teased twice on one page (carousel + list, differing query strings)
  // is fetched and rewritten once.
  const articleCache = new Map();

  // --- progress marker ------------------------------------------------------
  // A trailing badge whose glyph is a CSS ::after (so it never touches the
  // element's textContent, and detection/replacement logic is unaffected):
  // spinning 💀 while a headline is being killed, subtle ✨ once done.
  const style = document.createElement('style');
  style.textContent =
    '.klt-marker{display:inline-block;margin-left:.35em;font-size:.85em;line-height:1;vertical-align:baseline;text-decoration:none;}' +
    '.klt-marker::after{content:"\\1F480";}' /* 💀 */ +
    '.klt-marker.klt-working{animation:klt-spin .9s linear infinite;}' +
    '.klt-marker.klt-done{opacity:.5;font-size:.75em;}' +
    '.klt-marker.klt-done::after{content:"\\2728";}' /* ✨ */ +
    '.klt-marker.klt-paid::after{content:"\\1FAF0";}' /* 🫰 behind a paywall */ +
    '.klt-paywalled{opacity:.4;filter:grayscale(1);transition:opacity .2s ease;}' +
    '.klt-paywalled:hover{opacity:.75;}' +
    '.klt-paywalled-hidden{display:none!important;}' +
    '@keyframes klt-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.klt-marker.klt-working{animation:none;}}';
  (document.head || document.documentElement).appendChild(style);

  function addMarker(el) {
    if (el._kltMarker && el._kltMarker.isConnected) return;
    const span = document.createElement('span');
    span.className = 'klt-marker klt-working';
    span.setAttribute('aria-hidden', 'true');
    el.appendChild(span);
    el._kltMarker = span;
  }

  function setMarkerDone(el) {
    const span = el._kltMarker;
    if (span) span.className = 'klt-marker klt-done';
  }

  // Spinning 💀 → 🫰 : we could not read this one, it wants your money.
  function setMarkerPaid(el) {
    const span = el._kltMarker;
    if (span) span.className = 'klt-marker klt-paid';
  }

  function removeMarker(el) {
    const span = el._kltMarker;
    if (span && span.parentNode) span.parentNode.removeChild(span);
    el._kltMarker = null;
  }

  function collapse(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function looksLikeArticle(href) {
    return !!href && ARTICLE_PATTERNS.some((re) => re.test(href));
  }

  function abs(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return null;
    }
  }

  // Non-empty text nodes under `el`, in document order.
  function textNodes(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.trim()) out.push(n);
    }
    return out;
  }

  // The article URL associated with a headline element: a link inside it, an
  // ancestor <a>, or an article link within the surrounding card.
  function findArticleUrl(el) {
    if (el.tagName === 'A' && looksLikeArticle(el.getAttribute('href'))) {
      return abs(el.getAttribute('href'));
    }
    for (const a of el.querySelectorAll('a[href]')) {
      if (looksLikeArticle(a.getAttribute('href'))) return abs(a.getAttribute('href'));
    }
    const up = el.closest && el.closest('a[href]');
    if (up && looksLikeArticle(up.getAttribute('href'))) return abs(up.getAttribute('href'));
    let p = el.parentElement;
    for (let hop = 0; p && hop < CARD_LOOKUP_HOPS; hop++, p = p.parentElement) {
      for (const a of p.querySelectorAll('a[href]')) {
        if (looksLikeArticle(a.getAttribute('href'))) return abs(a.getAttribute('href'));
      }
    }
    return null;
  }

  // How many *distinct* articles an element links to. Used to find the biggest
  // ancestor that is still just this one teaser.
  function distinctArticleCount(el) {
    const seen = new Set();
    const add = (a) => {
      const href = a.getAttribute('href');
      if (!looksLikeArticle(href)) return;
      const u = abs(href);
      if (u) seen.add(u.split('?')[0].split('#')[0]);
    };
    if (el.tagName === 'A') add(el);
    if (el.querySelectorAll) for (const a of el.querySelectorAll('a[href]')) add(a);
    return seen.size;
  }

  // The element that visually *is* this teaser — what gets grayed out or hidden.
  // Walk up only while the candidate still covers exactly one article, so a
  // shared container (a news ticker, a card grid, a whole section) can never be
  // swallowed. Verified against the rendered front pages: <article class="teaser-*">
  // on IS, <div class="card fp-container"> on IL, and in IL's ticker the
  // <a class="news-ticker-item"> itself. Worst case it degrades to the headline.
  function teaserUnit(el) {
    const card = el.closest && el.closest('article,li');
    if (card && distinctArticleCount(card) === 1) return card;
    let best = el;
    let node = el;
    for (let hop = 0; hop < TEASER_LOOKUP_HOPS && node.parentElement; hop++) {
      node = node.parentElement;
      if (distinctArticleCount(node) !== 1) break;
      best = node;
    }
    return best;
  }

  const TIER_LABEL = { 'is-extra': 'IS Extra', 'il-plus': 'Iltalehti Plus' };

  function applyPaywallTreatment(el, tier) {
    const unit = teaserUnit(el);
    const rec = { el, unit, tier };
    treated.add(rec);
    if (paywallMode === 'hide') {
      removeMarker(el);
      unit.classList.add('klt-paywalled-hidden');
    } else {
      unit.classList.add('klt-paywalled');
      addMarker(el); // in case it was removed while hidden
      setMarkerPaid(el);
      el.title = 'Maksumuurin takana (' + (TIER_LABEL[tier] || 'maksullinen') + ')';
    }
    el.setAttribute(PROCESSED_ATTR, 'paid');
  }

  // Re-apply every recorded treatment after the setting changes, so switching
  // mode in the popup takes effect without a reload.
  function refreshPaywallTreatments() {
    for (const rec of treated) {
      rec.unit.classList.remove('klt-paywalled', 'klt-paywalled-hidden');
      if (paywallMode === 'off') {
        removeMarker(rec.el);
        rec.el.removeAttribute('title');
        continue;
      }
      if (paywallMode === 'hide') {
        removeMarker(rec.el);
        rec.unit.classList.add('klt-paywalled-hidden');
      } else {
        rec.unit.classList.add('klt-paywalled');
        addMarker(rec.el);
        setMarkerPaid(rec.el);
        rec.el.title = 'Maksumuurin takana (' + (TIER_LABEL[rec.tier] || 'maksullinen') + ')';
      }
    }
  }

  function markUnit(el, headline, url) {
    el.setAttribute(PROCESSED_ATTR, 'pending');
    el._kltHeadline = headline;
    el._kltUrl = url;
  }

  function inRange(text) {
    return text.length >= MIN_HEADLINE_LEN && text.length <= MAX_HEADLINE_LEN;
  }

  // A headline "unit" is the element whose text we will rewrite. We detect two
  // shapes: (1) heading elements (covers the hero/top story, where the <a> only
  // wraps the image), and (2) article-link anchors whose own text is the
  // headline. Headings are collected first so anchors around them are skipped.
  function collectUnits(root) {
    if (!root.querySelectorAll) return [];
    const out = [];

    for (const h of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (h.hasAttribute(PROCESSED_ATTR)) continue;
      const text = collapse(h.textContent);
      if (!inRange(text)) {
        h.setAttribute(PROCESSED_ATTR, 'skip');
        continue;
      }
      const url = findArticleUrl(h);
      if (!url) continue; // link may still be added by later DOM changes
      markUnit(h, text, url);
      out.push(h);
    }

    for (const a of root.querySelectorAll('a[href]')) {
      if (a.hasAttribute(PROCESSED_ATTR)) continue;
      if (!looksLikeArticle(a.getAttribute('href'))) {
        a.setAttribute(PROCESSED_ATTR, 'skip');
        continue;
      }
      // Skip anchors already covered by a handled heading (inside or around it).
      if (a.querySelector('[data-klikintappaja-state="pending"],[data-klikintappaja-state="done"]')) {
        a.setAttribute(PROCESSED_ATTR, 'skip');
        continue;
      }
      const owner = a.closest('h1,h2,h3,h4,h5,h6');
      if (owner && owner.hasAttribute(PROCESSED_ATTR)) {
        a.setAttribute(PROCESSED_ATTR, 'skip');
        continue;
      }
      const text = collapse(a.textContent);
      if (!inRange(text)) {
        a.setAttribute(PROCESSED_ATTR, 'skip');
        continue;
      }
      markUnit(a, text, abs(a.getAttribute('href')));
      out.push(a);
    }

    return out;
  }

  // --- lazy scheduling ------------------------------------------------------

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          io.unobserve(e.target);
          enqueue(e.target);
        }
      }
    },
    { rootMargin: '300px' }
  );

  function observeAll() {
    if (!enabled) return;
    for (const el of collectUnits(document)) io.observe(el);
  }

  function enqueue(el) {
    addMarker(el); // spinning 💀 appears as soon as the headline is in play
    queue.push(el);
    pump();
  }

  function pump() {
    while (enabled && inFlight < MAX_CONCURRENCY && queue.length) {
      const el = queue.shift();
      inFlight++;
      processUnit(el)
        .catch((err) => console.debug('[klikintappaja] process failed:', err))
        .finally(() => {
          inFlight--;
          pump();
        });
    }
  }

  // --- the per-headline pipeline -------------------------------------------

  // Hosted mode: ask the shared store for a headline by article ID and stop
  // there. No article fetch, no LLM call, no API key — the ID comes from the
  // front-page link alone, so this is both instant and free. The cost is
  // coverage: an article nobody has contributed yet simply has no headline.
  async function lookupShared(url) {
    const reply = await chrome.runtime.sendMessage({ type: 'lookup', url });
    if (!reply || reply.error) {
      if (reply && reply.error && reply.error !== 'not-found') {
        console.debug('[klikintappaja] lookup:', reply.error);
      }
      return null;
    }
    return reply.headline ? { headline: reply.headline } : null;
  }

  async function fetchAndRewrite(url, originalHeadline) {
    // Synchronous on purpose: the ID must be resolved before the first await,
    // or two headlines for the same article could both miss the map and fetch.
    // Every URL that got this far matched ARTICLE_PATTERNS, so the ID lookup
    // effectively always hits; the URL is a belt-and-braces fallback.
    const id = globalThis.KlikintappajaIds.articleIdFromUrl(url) || url;
    if (articleCache.has(id)) return articleCache.get(id);
    if (mode === 'hosted') {
      const p = lookupShared(url);
      articleCache.set(id, p);
      return p;
    }
    const p = (async () => {
      // Fetch via the service worker: content-script fetches can't go
      // cross-origin in MV3 even with host permission, and article links may
      // point to another site (e.g. a Kauppalehti teaser embedded on IL).
      const fetched = await chrome.runtime.sendMessage({ type: 'fetchArticle', url });
      if (!fetched || fetched.error) {
        if (fetched && fetched.error) console.debug('[klikintappaja] fetch:', fetched.error);
        return null;
      }
      let host = location.hostname;
      try {
        host = new URL(url).hostname;
      } catch {
        /* keep page host */
      }
      const doc = new DOMParser().parseFromString(fetched.html, 'text/html');
      const body = globalThis.UutisExtractors.extractArticleBody(doc, host);
      // Paywall check first: a locked article yields only the lede, so without
      // this an IS Extra teaser would get a headline written from its teaser text
      // while an IL Plus one would just fall through the length gate below.
      // A subscriber's fetch (cookies are sent) returns the full text, so
      // `locked` is false for them and the normal path runs.
      const pw = globalThis.UutisExtractors.detectPaywall(doc, host, body);
      if (pw.locked && paywallMode !== 'off') return { paywalled: pw.premium };
      if (!body || body.length < 120) return null; // not enough ground truth
      // Passed on even when paywallMode is 'off' and we are about to rewrite it
      // anyway: whether to *show* a locked article is a display preference,
      // whether to *share* one is not, and the two must not be conflated.
      const reply = await chrome.runtime.sendMessage({
        paywalled: pw.locked,
        type: 'rewrite',
        url,
        originalHeadline,
        body,
        mod: globalThis.UutisExtractors.extractModifiedAt(doc), // hint only
      });
      if (!reply || reply.error) {
        if (reply && reply.error) console.debug('[klikintappaja] llm:', reply.error);
        return null;
      }
      return reply.headline ? { headline: reply.headline } : null;
    })();
    articleCache.set(id, p);
    return p;
  }

  async function processUnit(el) {
    if (!enabled) return;
    const original = el._kltHeadline;
    const url = el._kltUrl;
    let result = null;
    try {
      result = await fetchAndRewrite(url, original);
    } catch (err) {
      console.debug('[klikintappaja] fetch/rewrite error:', err);
    }
    if (result && result.paywalled) {
      applyPaywallTreatment(el, result.paywalled);
      return;
    }
    const rewritten = result && result.headline;
    if (!rewritten || collapse(rewritten) === original) {
      removeMarker(el); // nothing changed — don't leave a badge behind
      el.setAttribute(PROCESSED_ATTR, 'skip');
      return;
    }
    const applied = applyHeadline(el, original, collapse(rewritten));
    if (applied) {
      setMarkerDone(el); // spinning 💀 → subtle ✨
      el.setAttribute(PROCESSED_ATTR, 'done');
      chrome.runtime.sendMessage({ type: 'increment' }).catch(() => {});
    } else {
      removeMarker(el);
      el.setAttribute(PROCESSED_ATTR, 'skip');
    }
  }

  // Replace the headline text WITHOUT disturbing markup/styling: rewrite the
  // element's text nodes in place (first node gets the new text, the rest are
  // blanked), keeping every wrapping <span>/class the site relies on. If the
  // element's text is only partly the headline (e.g. a card that also holds a
  // kicker or timestamp), descend to the deepest element that is exactly the
  // headline and rewrite there instead.
  function applyHeadline(el, original, rewritten) {
    // Gate on the element's own textContent — the source of truth — rather than
    // reconstructing it from text nodes. Headlines are split across spans and
    // whitespace-only text nodes in different ways per site (React renders
    // {kicker}{' '}{title}), and any manual join gets the spacing wrong.
    if (collapse(el.textContent) === original) {
      const nodes = textNodes(el);
      if (!nodes.length) return false;
      // Put the new text in the longest node (the main headline span, so its
      // styling carries through) and blank the other text-bearing nodes.
      let main = nodes[0];
      for (const n of nodes) {
        if (n.nodeValue.trim().length > main.nodeValue.trim().length) main = n;
      }
      for (const n of nodes) n.nodeValue = n === main ? rewritten : '';
      decorate(el, original);
      return true;
    }
    // el now holds more/other text (a card with extra meta, or the SPA
    // re-rendered): descend to the deepest element that is exactly the headline.
    let deepest = null;
    for (const c of el.querySelectorAll('*')) {
      if (collapse(c.textContent) === original && (!deepest || deepest.contains(c))) {
        deepest = c;
      }
    }
    if (deepest && deepest !== el) return applyHeadline(deepest, original, rewritten);
    console.debug('[klikintappaja] could not localize headline:', original, '| now:', collapse(el.textContent));
    return false;
  }

  function decorate(el, original) {
    el.setAttribute('data-klikintappaja-original', original);
    if (!el.title) el.title = 'Alkuperäinen: ' + original;
  }

  // --- toggle + dynamic content --------------------------------------------

  let rescanTimer = null;
  const mo = new MutationObserver(() => {
    if (!enabled || rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      observeAll();
    }, 400);
  });

  function start() {
    observeAll();
    mo.observe(document.body, { childList: true, subtree: true });
  }

  chrome.storage.local.get({ enabled: true, paywallMode: 'dim', mode: 'key' }, (cfg) => {
    enabled = cfg.enabled !== false;
    if (PAYWALL_MODES.includes(cfg.paywallMode)) paywallMode = cfg.paywallMode;
    if (cfg.mode === 'hosted' || cfg.mode === 'key') mode = cfg.mode;
    if (enabled) start();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (enabled) start();
    }
    if (changes.mode) {
      const next = changes.mode.newValue;
      if (next === 'hosted' || next === 'key') mode = next;
    }
    if (changes.paywallMode) {
      const next = changes.paywallMode.newValue;
      if (PAYWALL_MODES.includes(next) && next !== paywallMode) {
        paywallMode = next;
        refreshPaywallTreatments();
      }
    }
  });
})();
