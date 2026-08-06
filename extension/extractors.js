// Per-site article-body extraction, ported from the `uutis` reference project
// (src/uutis/crawler/sources/fi.py and .../sources/base.py). Operates on a
// Document parsed from the fetched article HTML.
//
// Classic content-script global (no ES modules in content scripts): everything
// is exposed on globalThis.UutisExtractors for content.js to use.

(function () {
  const MAX_BODY_CHARS = 8000; // cap tokens/cost; the lede carries the payoff

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Iltalehti: text inside div.article-body  (fi.py: Iltalehti.get_content)
  function extractIltalehti(doc) {
    const body = doc.querySelector('div.article-body');
    return textOf(body);
  }

  // Ilta-Sanomat / is.fi: <h1> + every <p> inside <main>
  // (fi.py: Iltasanomat.get_content)
  function extractIltasanomat(doc) {
    const h1 = textOf(doc.querySelector('h1'));
    const main = doc.querySelector('main');
    const paras = main
      ? Array.from(main.querySelectorAll('p')).map(textOf).filter(Boolean)
      : [];
    return [h1, paras.join('\n\n')].filter(Boolean).join('\n\n');
  }

  // Generic fallback: first <h1> then <article> <p>, else any <p>
  // (base.py: GenericArticleMixin.get_content)
  function extractGeneric(doc) {
    const h1 = textOf(doc.querySelector('h1'));
    let paras = Array.from(doc.querySelectorAll('article p')).map(textOf).filter(Boolean);
    if (paras.length === 0) {
      paras = Array.from(doc.querySelectorAll('p')).map(textOf).filter(Boolean);
    }
    return [h1, paras.join('\n\n')].filter(Boolean).join('\n\n');
  }

  function extractArticleBody(doc, host) {
    let text = '';
    if (/(^|\.)iltalehti\.fi$/.test(host)) {
      text = extractIltalehti(doc);
    } else if (/(^|\.)is\.fi$/.test(host) || /(^|\.)iltasanomat\.fi$/.test(host)) {
      text = extractIltasanomat(doc);
    }
    // Fall back to the generic extractor if the site-specific one came up short
    // (mirrors the Python mixins' try/except fallbacks).
    if (!text || text.length < 120) {
      const generic = extractGeneric(doc);
      if (generic.length > text.length) text = generic;
    }
    return text.slice(0, MAX_BODY_CHARS);
  }

  // The article's own "last edited" timestamp, when the page states one. Stored
  // alongside a cached headline as a diagnostic hint — NOT as a cache validator:
  // an edit that doesn't change the extracted body can't change the generated
  // headline, so it would only trigger regenerations that produce the same text.
  // IS puts it in JSON-LD and <meta name="article:modified_time">, IL in
  // <meta itemprop="dateModified">.
  function extractModifiedAt(doc) {
    const meta =
      doc.querySelector('meta[itemprop="dateModified" i]') ||
      doc.querySelector('meta[property="article:modified_time" i]') ||
      doc.querySelector('meta[name="article:modified_time" i]');
    const fromMeta = meta && meta.getAttribute('content');
    if (fromMeta) return fromMeta.trim();
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const m = /"dateModified"\s*:\s*"([^"]+)"/.exec(s.textContent || '');
      if (m) return m[1];
    }
    return null;
  }

  // --- paywall detection ----------------------------------------------------
  // Whether the fetched article is premium, and whether we actually got its
  // text. Signals below were derived by diffing locked vs free articles fetched
  // anonymously from both sites (2026-08-06): each appeared in *every* locked
  // article and in *no* free one.
  //
  // The premium flags describe the ARTICLE, not the reader — a logged-in
  // subscriber's copy carries them too. So "can we read it" is a separate,
  // length-based test: a locked copy returns only the lede (measured: IL 19–30
  // chars, IS 540–752) where a readable one returns thousands.
  const READABLE_MIN_CHARS = 1000;

  // Every JSON-LD object on the page, flattened (arrays and @graph included).
  function ldEntities(doc) {
    const out = [];
    const push = (v) => {
      if (!v || typeof v !== 'object') return;
      out.push(v);
      if (Array.isArray(v['@graph'])) v['@graph'].forEach(push);
    };
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent || 'null');
      } catch {
        continue; // malformed blob — ignore
      }
      if (Array.isArray(data)) data.forEach(push);
      else push(data);
    }
    return out;
  }

  // The page's OWN article entity. Scoping to this matters: an is.fi page embeds
  // metadata for the IS Extra articles it promotes in sidebars, so a page-wide
  // search for a "paid" flag reports every page that merely links to Extra
  // content as paywalled.
  function articleEntity(doc) {
    const isArticle = (t) =>
      (Array.isArray(t) ? t : [t]).some((x) => typeof x === 'string' && /Article$/.test(x));
    return ldEntities(doc).find((o) => isArticle(o['@type'])) || null;
  }

  function accessibleForFree(entity) {
    if (!entity) return null;
    const v = entity.isAccessibleForFree;
    if (v === true || v === false) return v;
    if (typeof v === 'string') {
      if (/^(false|no)$/i.test(v)) return false;
      if (/^(true|yes)$/i.test(v)) return true;
    }
    return null;
  }

  function premiumOf(doc, host) {
    if (/(^|\.)iltalehti\.fi$/.test(host) || /(^|\.)kauppalehti\.fi$/.test(host)) {
      // IL publishes no isAccessibleForFree, and has no single state container
      // to scope a JSON search to, so go by the Plus / Plus Extra article chrome
      // on the article element itself — which is properly scoped, unlike a
      // page-wide search for "contentCharge":"paid" (an IL page can embed that
      // for the Plus teasers it links to). If IL renames these classes this
      // fails open: the article is treated as ordinary, never wrongly hidden.
      return doc.querySelector('.plus-article, .article-plus, .plus-lead, .plus-title')
        ? 'il-plus'
        : null;
    }
    // IS states it properly in schema.org terms on the article itself.
    return accessibleForFree(articleEntity(doc)) === false ? 'is-extra' : null;
  }

  // -> { premium: 'is-extra' | 'il-plus' | null, locked: boolean }
  function detectPaywall(doc, host, body) {
    const premium = premiumOf(doc, host);
    const text = typeof body === 'string' ? body : extractArticleBody(doc, host);
    return { premium, locked: !!premium && text.length < READABLE_MIN_CHARS };
  }

  globalThis.UutisExtractors = {
    extractArticleBody,
    extractModifiedAt,
    detectPaywall,
    READABLE_MIN_CHARS,
  };
})();
