"""Shared fixtures.

The database is doubled in-memory rather than mocked at the driver level: the
routes only ever touch the handful of methods on `Database`, so a small fake is
both faster and a better description of the contract than a mongo stand-in.
"""

import datetime

import pytest
from fastapi.testclient import TestClient

from klikintappaja_api import create_app
from klikintappaja_api._db import Headline
from klikintappaja_api.auth import Caller, InvalidTokenError

VALID_TOKEN = 'valid-token'
CONTRIBUTOR_KEY = 'contributor-user-key'
READER_KEY = 'reader-user-key'


class FakeDatabase:
    """In-memory stand-in implementing the slice of `Database` the routes use."""

    def __init__(self) -> None:
        """Start empty, with nobody approved and no quota consumed."""
        self.headlines: dict[str, Headline] = {}
        self.contributors: set[str] = set()
        self.counts: dict[str, int] = {}
        self.quota_limit_override: int | None = None
        self.ping_fails = False

    async def ensure_indexes(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def ping(self) -> dict:
        if self.ping_fails:
            msg = 'unreachable'
            raise RuntimeError(msg)
        return {'ok': 1.0}

    async def get_headline(self, article_id: str) -> Headline | None:
        return self.headlines.get(article_id)

    async def put_headline(self, headline: Headline) -> None:
        self.headlines[headline.article_id] = headline

    async def is_contributor(self, user_key: str) -> bool:
        return user_key in self.contributors

    async def purge_contributions(self, user_key: str) -> int:
        doomed = [k for k, v in self.headlines.items() if v.contributor == user_key]
        for key in doomed:
            del self.headlines[key]
        return len(doomed)

    async def consume_quota(self, user_key: str, window: str, limit: int, ttl_seconds: int) -> bool:  # noqa: ARG002
        key = f'{user_key}:{window}'
        self.counts[key] = self.counts.get(key, 0) + 1
        effective = self.quota_limit_override if self.quota_limit_override is not None else limit
        return self.counts[key] <= effective


class FakeVerifier:
    """Accepts one known token and rejects everything else."""

    def __init__(self) -> None:
        """Register the single token that authenticates as a plain reader."""
        self.tokens = {VALID_TOKEN: READER_KEY}

    def user_key(self, subject: str) -> str:
        return f'hmac-of-{subject}'

    async def verify(self, token: str) -> Caller:
        try:
            return Caller(user_key=self.tokens[token])
        except KeyError as exc:
            msg = 'ID token rejected'
            raise InvalidTokenError(msg) from exc


@pytest.fixture
def db() -> FakeDatabase:
    return FakeDatabase()


@pytest.fixture
def verifier() -> FakeVerifier:
    return FakeVerifier()


@pytest.fixture
def client(db: FakeDatabase, verifier: FakeVerifier) -> TestClient:
    app = create_app(db=db, verifier=verifier)
    return TestClient(app)


@pytest.fixture
def auth() -> dict[str, str]:
    return {'Authorization': f'Bearer {VALID_TOKEN}'}


@pytest.fixture
def contributor(db: FakeDatabase, verifier: FakeVerifier) -> dict[str, str]:
    """Authenticate as a caller who is also on the contributor allowlist."""
    token = 'contributor-token'
    verifier.tokens[token] = CONTRIBUTOR_KEY
    db.contributors.add(CONTRIBUTOR_KEY)
    return {'Authorization': f'Bearer {token}'}


def make_headline(article_id: str = 'is:2000012186173', **overrides) -> Headline:
    fields = {
        'article_id': article_id,
        'headline': 'Ministeri kertoi budjettileikkauksista tiistaina',
        'sha': 'deadbeefdeadbeef',
        'provider': 'gemini',
        'model': 'gemini-2.5-flash-lite',
        'contributor': CONTRIBUTOR_KEY,
        'generated_at': datetime.datetime(2026, 8, 7, 12, 0, tzinfo=datetime.UTC),
    }
    fields.update(overrides)
    return Headline(**fields)


BODY = (
    'Pääministeri kommentoi tilannetta pitkästi ja toistuvasti tiistaina '
    'pidetyssä tiedotustilaisuudessa, jossa käsiteltiin ensi vuoden budjettia '
    'ja siihen liittyviä leikkauksia sekä niiden vaikutuksia kuntiin.'
)
