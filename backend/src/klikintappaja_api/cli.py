"""Administrative commands.

Contributor management is the only privileged operation this service has, and it
is rare enough that a command line beats building any admin UI.

Callers are known only by an HMAC of their Google subject, so approving someone
means getting that key from them: the extension shows it, and it is also what
appears in a 403 response's logs.
"""

import argparse
import asyncio
import sys
from collections.abc import Sequence

from klikintappaja_api._db import Database


async def _approve(db: Database, user_key: str, note: str) -> str:
    await db.approve_contributor(user_key, note)
    return f'approved {user_key}'


async def _ban(db: Database, user_key: str) -> str:
    await db.ban_contributor(user_key)
    return f'banned {user_key} (contributions kept; purge separately)'


async def _purge(db: Database, user_key: str) -> str:
    removed = await db.purge_contributions(user_key)
    return f'removed {removed} headline(s) contributed by {user_key}'


async def _run(args: argparse.Namespace) -> str:
    db = Database()
    try:
        match args.command:
            case 'approve-user':
                return await _approve(db, args.user_key, args.note)
            case 'ban-user':
                return await _ban(db, args.user_key)
            case 'purge-contributions':
                return await _purge(db, args.user_key)
            case _:  # pragma: no cover - argparse rejects unknown commands first
                msg = f'unknown command {args.command!r}'
                raise ValueError(msg)
    finally:
        await db.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='klikintappaja-api-tool', description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)

    approve = sub.add_parser('approve-user', help='allow an account to contribute headlines')
    approve.add_argument('user_key')
    approve.add_argument('--note', default='', help='free-text reminder of who this is')

    ban = sub.add_parser('ban-user', help='revoke contribution rights')
    ban.add_argument('user_key')

    purge = sub.add_parser('purge-contributions', help='delete everything an account contributed')
    purge.add_argument('user_key')

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point for `klikintappaja-api-tool`."""
    args = _parser().parse_args(argv)
    print(asyncio.run(_run(args)))
    return 0


if __name__ == '__main__':  # pragma: no cover
    sys.exit(main())
