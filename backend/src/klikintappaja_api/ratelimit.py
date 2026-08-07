"""Per-caller request quotas.

There is no LLM bill to defend here — contributors pay for their own generations
— so these limits exist only to blunt abuse: bulk-scraping the read endpoint, or
a misbehaving client flooding writes.

Backed by MongoDB rather than Redis on purpose. Redis would mean Memorystore,
a standing monthly cost for a service that otherwise runs on Cloud Run's
scale-to-zero and an Atlas free tier.
"""

import datetime
from dataclasses import dataclass

# Windows are fixed buckets rather than a sliding log: one document per caller
# per window, self-expiring, and no history to sweep.
WINDOW_SECONDS = 3600
READ_LIMIT_PER_WINDOW = 2000
WRITE_LIMIT_PER_WINDOW = 500


@dataclass(frozen=True, slots=True)
class Quota:
    """One quota bucket's configuration."""

    name: str
    limit: int
    window_seconds: int = WINDOW_SECONDS

    def window_for(self, now: datetime.datetime) -> str:
        """Identify the bucket containing `now`."""
        bucket = int(now.timestamp()) // self.window_seconds
        return f'{self.name}:{bucket}'


READ_QUOTA = Quota(name='read', limit=READ_LIMIT_PER_WINDOW)
WRITE_QUOTA = Quota(name='write', limit=WRITE_LIMIT_PER_WINDOW)
