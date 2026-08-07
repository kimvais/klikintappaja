"""MongoDB access.

Deliberately narrow: the routes talk to this class and nothing else, so the tests
can substitute an in-memory double instead of standing up a database.

Note what is *not* stored. Article bodies arrive on every contribution, are used
to compute a fingerprint, and are then dropped. Only the headline and that
fingerprint are persisted, which keeps publishers' article text off this service
entirely.
"""

import datetime
import os
from dataclasses import asdict, dataclass

import pymongo
from pymongo import AsyncMongoClient
from pymongo.errors import DuplicateKeyError

DB_NAME = 'uut_is'


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


@dataclass(frozen=True, slots=True)
class Headline:
    """A stored headline and the provenance needed to audit or purge it."""

    article_id: str
    headline: str
    sha: str
    provider: str
    model: str
    contributor: str
    generated_at: datetime.datetime

    def as_document(self) -> dict:
        """Render for storage, with the article ID as `_id`."""
        document = asdict(self)
        document['_id'] = document.pop('article_id')
        return document

    @classmethod
    def from_document(cls, document: dict) -> 'Headline':
        """Rebuild from a stored document."""
        fields = dict(document)
        fields['article_id'] = fields.pop('_id')
        fields.pop('_v', None)
        return cls(**fields)


class Database:
    """Everything this service needs from MongoDB."""

    def __init__(self, uri: str | None = None) -> None:
        self.client = AsyncMongoClient(
            uri or os.environ['MONGODB_URI'], uuidRepresentation='standard', tz_aware=True
        )
        self.db = self.client[DB_NAME]
        self.headlines = self.db.klikintappaja_headlines
        self.contributors = self.db.klikintappaja_contributors
        self.quota = self.db.klikintappaja_quota

    async def close(self) -> None:
        """Release the connection pool."""
        await self.client.close()

    async def ensure_indexes(self) -> None:
        """Create the indexes the service relies on.

        Idempotent, so it is safe to run on every start-up.
        """
        await self.headlines.create_index('contributor')
        # Quota documents delete themselves once their window has passed.
        await self.quota.create_index('expires_at', expireAfterSeconds=0)

    async def ping(self) -> dict:
        """Check the database is reachable."""
        with pymongo.timeout(1):
            return await self.db.command('ping')

    async def get_headline(self, article_id: str) -> Headline | None:
        """Fetch the current headline for an article, if one exists."""
        document = await self.headlines.find_one({'_id': article_id})
        return Headline.from_document(document) if document else None

    async def put_headline(self, headline: Headline) -> None:
        """Store a headline, replacing any earlier version of the same article."""
        await self.headlines.replace_one({'_id': headline.article_id}, headline.as_document(), upsert=True)

    async def is_contributor(self, user_key: str) -> bool:
        """Whether this caller is approved to write headlines."""
        document = await self.contributors.find_one({'_id': user_key, 'banned': {'$ne': True}})
        return document is not None

    async def approve_contributor(self, user_key: str, note: str = '') -> None:
        """Add or re-enable a contributor."""
        await self.contributors.update_one(
            {'_id': user_key},
            {'$set': {'banned': False, 'note': note, 'approved_at': _utcnow()}},
            upsert=True,
        )

    async def ban_contributor(self, user_key: str) -> None:
        """Revoke write access without losing the record of who it was."""
        await self.contributors.update_one(
            {'_id': user_key}, {'$set': {'banned': True, 'banned_at': _utcnow()}}, upsert=True
        )

    async def purge_contributions(self, user_key: str) -> int:
        """Delete every headline a contributor submitted.

        The reason each document carries its contributor: a bad actor's whole
        history can be removed in one step.

        Returns:
            How many headlines were removed.

        """
        result = await self.headlines.delete_many({'contributor': user_key})
        return result.deleted_count

    async def consume_quota(self, user_key: str, window: str, limit: int, ttl_seconds: int) -> bool:
        """Count one request against a caller's quota window.

        A single atomic upsert-and-increment; the document expires by TTL index,
        so nothing has to sweep old windows.

        Args:
            user_key: The caller.
            window: Identifier of the current time window.
            limit: Maximum requests allowed within the window.
            ttl_seconds: How long the counter should survive.

        Returns:
            True if the request is within quota.

        """
        key = f'{user_key}:{window}'
        try:
            document = await self.quota.find_one_and_update(
                {'_id': key},
                {
                    '$inc': {'count': 1},
                    '$setOnInsert': {'expires_at': _utcnow() + datetime.timedelta(seconds=ttl_seconds)},
                },
                upsert=True,
                return_document=pymongo.ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            # Lost an insert race; the winning document is authoritative.
            document = await self.quota.find_one({'_id': key}) or {'count': limit + 1}
        return document['count'] <= limit
