"""Article identity, and the cross-language agreement the whole cache rests on."""

import json
import pathlib
import shutil
import subprocess

import pytest

from klikintappaja_api.articles import (
    MalformedArticleIdError,
    UnknownSiteError,
    content_hash,
    parse_article_ref,
)

EXTENSION_DIR = pathlib.Path(__file__).resolve().parents[2] / 'extension'

# By codepoint, so no invisible characters end up in this file.
NBSP = chr(0x00A0)
BOM = chr(0xFEFF)


# Chosen to exercise the normalization rules rather than just the happy path:
# collapsed runs, leading/trailing space, a non-breaking space, a BOM (which
# Python's str.split() does NOT treat as whitespace but ECMAScript's \s does),
# and non-ASCII text, since these headlines are Finnish.
HASH_CASES = [
    'Pääministeri kertoi budjetista',
    '  leading and trailing  ',
    'collapsed\n\n\twhitespace   runs',
    f'non{NBSP}breaking{NBSP}spaces',
    f'byte{BOM}ordermark',
    'sekä ääkkösiä että öitä ja pitkä ajatusviiva',
    '',
    ' ',
]


def test_article_ref_builds_tagged_id():
    assert parse_article_ref('is', '2000012186173').article_id == 'is:2000012186173'
    assert (
        parse_article_ref('il', '1ee556a4-b80a-4199-8d45-88b5870f4330').article_id
        == 'a:1ee556a4-b80a-4199-8d45-88b5870f4330'
    )


def test_article_ref_normalises_case():
    ref = parse_article_ref('IL', '1EE556A4-B80A-4199-8D45-88B5870F4330')
    assert ref.article_id == 'a:1ee556a4-b80a-4199-8d45-88b5870f4330'


@pytest.mark.parametrize(
    ('site', 'raw_id'),
    [
        ('is', 'not-a-number'),
        ('is', ''),
        ('il', '1ee556a4'),
        ('il', '1ee556a4-b80a-4199-8d45-88b5870f4330-extra'),
        ('is', '2000012186173; drop table'),
    ],
)
def test_malformed_ids_are_rejected(site: str, raw_id: str):
    with pytest.raises(MalformedArticleIdError):
        parse_article_ref(site, raw_id)


@pytest.mark.parametrize('site', ['hs', 'yle', '', '../..'])
def test_unknown_sites_are_rejected(site: str):
    with pytest.raises(UnknownSiteError):
        parse_article_ref(site, '2000012186173')


def test_hash_is_stable_across_whitespace_shapes():
    assert content_hash('a b') == content_hash('  a \n\t b  ')


def test_hash_collapses_exotic_whitespace():
    """A BOM is whitespace to ECMAScript but not to `str.split()`."""
    assert content_hash(f'a{BOM}b') == content_hash('a b')
    assert content_hash(f'a{NBSP}b') == content_hash('a b')


def test_hash_distinguishes_real_edits():
    assert content_hash('the original text') != content_hash('the original text, updated')


@pytest.mark.skipif(shutil.which('node') is None, reason='node is required for this comparison')
def test_hash_matches_the_extension():
    """The server and the extension must fingerprint identically.

    If these two ever drift, clients would look up a hash the server never stores
    and the shared cache would silently stop matching, with no error anywhere.
    Hence comparing against the real JS rather than a reimplementation of it.
    """
    script = f"""
        const {{ readFileSync }} = require('node:fs');
        new Function(readFileSync({json.dumps(str(EXTENSION_DIR / 'articleid.js'))}, 'utf8'))();
        const cases = JSON.parse({json.dumps(json.dumps(HASH_CASES))});
        (async () => {{
          const out = [];
          for (const c of cases) out.push(await globalThis.KlikintappajaIds.contentHash(c));
          process.stdout.write(JSON.stringify(out));
        }})();
    """
    completed = subprocess.run(
        ['node', '-e', script], capture_output=True, text=True, check=True, encoding='utf-8'
    )
    assert json.loads(completed.stdout) == [content_hash(case) for case in HASH_CASES]
