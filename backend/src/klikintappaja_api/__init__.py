"""Klikintappaja shared-headline API.

A small read-mostly service: signed-in users look up de-clickbaited headlines by
article ID, and an allowlisted set of contributors — people running the extension
with their own LLM key — supply them. The server never calls a model itself.
"""

import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from klikintappaja_api._db import Database
from klikintappaja_api.auth import TokenVerifier
from klikintappaja_api.headlines import health_router, router

__all__ = ['create_app']

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Open the database for the life of the application."""
    db: Database = app.state.db
    await db.ensure_indexes()
    yield
    await db.close()


def create_app(db: Database | None = None, verifier: TokenVerifier | None = None) -> FastAPI:
    """Build the application.

    Args:
        db: Database handle; constructed from `MONGODB_URI` when omitted.
        verifier: Token verifier; constructed from the environment when omitted.

    Returns:
        The configured application.

    """
    app = FastAPI(title='Klikintappaja API', lifespan=lifespan)
    app.state.db = db or Database()
    app.state.verifier = verifier or TokenVerifier()

    # The callers are browser extensions, whose origin is a chrome-extension://
    # URL rather than a site we can enumerate. Credentials are never used —
    # every request carries an explicit bearer token — so a wildcard origin
    # grants nothing beyond what a token already permits.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_credentials=False,
        allow_methods=['GET', 'POST'],
        allow_headers=['Authorization', 'Content-Type', 'If-None-Match'],
        expose_headers=['ETag'],
    )

    app.include_router(router)
    app.include_router(health_router)
    return app


def main() -> None:
    """Run a development server."""
    import uvicorn

    logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'))
    uvicorn.run(create_app(), host='127.0.0.1', port=int(os.environ.get('PORT', '8080')))
