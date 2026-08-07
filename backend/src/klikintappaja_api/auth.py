"""Google sign-in, used as a rate-limit anchor rather than as an identity.

We never learn or store who anyone is. A Google ID token is verified offline,
and the only thing kept from it is an HMAC of the `sub` claim — enough to count
requests per natural person, useless for identifying one. Scope `openid` alone is
requested by the client, so no email or profile is ever received in the first
place.
"""

import hmac
import os
from dataclasses import dataclass
from hashlib import sha256

import anyio
import jwt
from jwt import PyJWKClient

GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
GOOGLE_ISSUERS = frozenset({'accounts.google.com', 'https://accounts.google.com'})


class InvalidTokenError(Exception):
    """Raised when an ID token is missing, malformed, expired or not ours."""


@dataclass(frozen=True, slots=True)
class Caller:
    """An authenticated request's pseudonymous subject."""

    user_key: str


class TokenVerifier:
    """Verifies Google ID tokens and reduces them to a pseudonymous key.

    Configuration is read once at construction so that a missing environment
    variable fails at startup rather than on the first request.
    """

    def __init__(self, client_id: str | None = None, secret: str | None = None) -> None:
        """Read configuration, falling back to the environment.

        Args:
            client_id: OAuth client ID that ID tokens must be addressed to.
            secret: HMAC key used to pseudonymise subject IDs.

        """
        self._client_id = client_id or os.environ['GOOGLE_OAUTH_CLIENT_ID']
        self._secret = (secret or os.environ['SERVER_SECRET']).encode('utf-8')
        self._jwks = PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True)

    def user_key(self, subject: str) -> str:
        """Pseudonymise a Google `sub` claim.

        Args:
            subject: The `sub` claim from a verified ID token.

        Returns:
            A stable, irreversible key for that account.

        """
        return hmac.new(self._secret, subject.encode('utf-8'), sha256).hexdigest()

    def _verify_sync(self, token: str) -> str:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=['RS256'],
                audience=self._client_id,
                options={'require': ['exp', 'iat', 'iss', 'sub']},
            )
        except Exception as exc:  # PyJWT raises a wide family of decode errors
            msg = f'ID token rejected: {exc}'
            raise InvalidTokenError(msg) from exc

        # PyJWT validates a single issuer string; Google uses two spellings, so
        # the check is done here against both rather than picking one.
        if claims['iss'] not in GOOGLE_ISSUERS:
            msg = f'unexpected issuer {claims["iss"]!r}'
            raise InvalidTokenError(msg)

        return self.user_key(claims['sub'])

    async def verify(self, token: str) -> Caller:
        """Verify an ID token.

        Args:
            token: The raw JWT from the `Authorization: Bearer` header.

        Returns:
            The caller's pseudonymous key.

        Raises:
            InvalidTokenError: If the token fails any validation step.

        """
        # PyJWKClient fetches and caches Google's keys over blocking HTTP; keep it
        # off the event loop. After the first call this is a cache hit.
        user_key = await anyio.to_thread.run_sync(self._verify_sync, token)
        return Caller(user_key=user_key)


def bearer_token(authorization: str | None) -> str:
    """Extract the credential from an `Authorization` header.

    Args:
        authorization: Raw header value, if any.

    Returns:
        The bare token.

    Raises:
        InvalidTokenError: If the header is absent or not a Bearer credential.

    """
    if not authorization:
        msg = 'missing Authorization header'
        raise InvalidTokenError(msg)
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token.strip():
        msg = 'expected an "Authorization: Bearer <id_token>" header'
        raise InvalidTokenError(msg)
    return token.strip()
