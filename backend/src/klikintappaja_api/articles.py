"""Article identity and content fingerprinting.

Both functions here must agree **exactly** with their JavaScript counterparts in
`extension/articleid.js`; a client and the server that disagree about either one
would build two caches that never intersect. `tests/test_articles.py` asserts the
agreement against the real JS implementation rather than trusting this comment.
"""

import hashlib
import re
from dataclasses import dataclass

# The URL path segment a client uses, mapped to the tag stored in Mongo. The tags
# come from `articleIdFromUrl()` in extension/articleid.js: Ilta-Sanomat article
# URLs carry an integer, Iltalehti (and Kauppalehti, sharing the Alma CMS) a UUID.
SITE_TAGS = {
    'il': 'a',
    'is': 'is',
}

_IS_ID = re.compile(r'^\d{1,20}$')
_IL_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)

_ID_PATTERNS = {
    'il': _IL_ID,
    'is': _IS_ID,
}

# ECMAScript's \s, by codepoint — writing it with literal characters would put
# eight invisible glyphs in this file. Python's str.split() is *nearly* the same
# set but excludes U+FEFF, so relying on it would make the server disagree with
# the extension on any body carrying a stray BOM. Verified, not assumed: see
# test_hash_matches_the_extension.
_JS_WHITESPACE_CODEPOINTS = (
    0x09,  # tab
    0x0A,  # line feed
    0x0B,  # vertical tab
    0x0C,  # form feed
    0x0D,  # carriage return
    0x20,  # space
    0xA0,  # no-break space
    0x1680,  # ogham space mark
    *range(0x2000, 0x200B),  # en quad .. hair space
    0x2028,  # line separator
    0x2029,  # paragraph separator
    0x202F,  # narrow no-break space
    0x205F,  # medium mathematical space
    0x3000,  # ideographic space
    0xFEFF,  # zero-width no-break space (BOM)
)
_JS_WHITESPACE = re.compile('[' + ''.join(re.escape(chr(cp)) for cp in _JS_WHITESPACE_CODEPOINTS) + ']+')


class UnknownSiteError(ValueError):
    """Raised for a path segment that is not a supported site."""


class MalformedArticleIdError(ValueError):
    """Raised for an article ID that does not match its site's shape."""


@dataclass(frozen=True, slots=True)
class ArticleRef:
    """A validated reference to one article."""

    site: str
    raw_id: str

    @property
    def article_id(self) -> str:
        """The tagged ID used as the Mongo `_id`, e.g. `is:2000012186173`."""
        return f'{SITE_TAGS[self.site]}:{self.raw_id}'


def parse_article_ref(site: str, raw_id: str) -> ArticleRef:
    """Validate a `{site}/{id}` pair from a request path.

    Args:
        site: Path segment naming the publication (`is` or `il`).
        raw_id: The publication's own article ID.

    Returns:
        The validated reference.

    Raises:
        UnknownSiteError: If the site segment is not supported.
        MalformedArticleIdError: If the ID does not match that site's format.

    """
    site = site.lower()
    if site not in SITE_TAGS:
        msg = f'unknown site {site!r}'
        raise UnknownSiteError(msg)
    if not _ID_PATTERNS[site].match(raw_id):
        msg = f'{raw_id!r} is not a valid {site} article ID'
        raise MalformedArticleIdError(msg)
    return ArticleRef(site=site, raw_id=raw_id.lower())


def content_hash(text: str) -> str:
    """Fingerprint the article body the model was shown.

    Whitespace is collapsed first so that reflowed markup alone cannot look like
    an edit. Mirrors `contentHash()` in extension/articleid.js: SHA-256 over the
    normalized text, truncated to the first 8 bytes.

    Args:
        text: The extracted article body.

    Returns:
        16 lowercase hex characters.

    """
    normalized = _JS_WHITESPACE.sub(' ', text or '').strip(' ')
    return hashlib.sha256(normalized.encode('utf-8')).digest()[:8].hex()
