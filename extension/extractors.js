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

  globalThis.UutisExtractors = { extractArticleBody };
})();
