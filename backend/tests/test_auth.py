"""Token verification, with real RS256 signatures rather than a stubbed decoder.

The point of these is the refusals: an ID token that is expired, addressed to
someone else's OAuth client, or issued by anything but Google must not
authenticate a caller.
"""

import datetime

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from klikintappaja_api.auth import InvalidTokenError, TokenVerifier, bearer_token

DEV_CLIENT = 'dev-client.apps.googleusercontent.com'
PROD_CLIENT = 'prod-client.apps.googleusercontent.com'


@pytest.fixture(scope='module')
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@pytest.fixture
def verifier(keypair, monkeypatch):
    """Build a verifier trusting both OAuth clients, with our test key as Google's."""
    _, public = keypair
    verifier = TokenVerifier(client_id=f'{DEV_CLIENT}, {PROD_CLIENT}', secret='test-secret')

    class _Key:
        key = public

    monkeypatch.setattr(verifier._jwks, 'get_signing_key_from_jwt', lambda _token: _Key())
    return verifier


def make_token(keypair, **overrides) -> str:
    private, _ = keypair
    now = datetime.datetime.now(datetime.UTC)
    claims = {
        'iss': 'https://accounts.google.com',
        'aud': PROD_CLIENT,
        'sub': '1234567890',
        'iat': now,
        'exp': now + datetime.timedelta(hours=1),
    }
    claims.update(overrides)
    # Passing None omits a claim entirely, so tests can build tokens that are
    # missing one.
    claims = {k: v for k, v in claims.items() if v is not None}
    pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(claims, pem, algorithm='RS256')


# --- refusals ---------------------------------------------------------------


async def test_expired_token_is_rejected(verifier, keypair):
    past = datetime.datetime.now(datetime.UTC) - datetime.timedelta(hours=2)
    token = make_token(keypair, iat=past, exp=past + datetime.timedelta(minutes=5))
    with pytest.raises(InvalidTokenError):
        await verifier.verify(token)


async def test_token_for_another_client_is_rejected(verifier, keypair):
    with pytest.raises(InvalidTokenError):
        await verifier.verify(make_token(keypair, aud='someone-elses-client'))


async def test_token_from_another_issuer_is_rejected(verifier, keypair):
    with pytest.raises(InvalidTokenError):
        await verifier.verify(make_token(keypair, iss='https://evil.example'))


async def test_token_without_subject_is_rejected(verifier, keypair):
    """No `sub` means no quota identity, so the token is useless to us."""
    with pytest.raises(InvalidTokenError):
        await verifier.verify(make_token(keypair, sub=None))


async def test_garbage_is_rejected(verifier):
    with pytest.raises(InvalidTokenError):
        await verifier.verify('clearly-not-a-jwt')


@pytest.mark.parametrize('header', [None, '', 'Basic aGk6dGhlcmU=', 'Bearer', 'Bearer   '])
def test_bad_authorization_headers_are_rejected(header):
    with pytest.raises(InvalidTokenError):
        bearer_token(header)


# --- acceptance -------------------------------------------------------------


async def test_production_client_token_is_accepted(verifier, keypair):
    caller = await verifier.verify(make_token(keypair, aud=PROD_CLIENT))
    assert caller.user_key


async def test_development_client_token_is_accepted(verifier, keypair):
    """One deployment must serve both the published extension and a dev build."""
    caller = await verifier.verify(make_token(keypair, aud=DEV_CLIENT))
    assert caller.user_key


async def test_both_clients_map_one_person_to_one_key(verifier, keypair):
    """The same Google account is the same quota subject from either build."""
    from_dev = await verifier.verify(make_token(keypair, aud=DEV_CLIENT))
    from_prod = await verifier.verify(make_token(keypair, aud=PROD_CLIENT))
    assert from_dev.user_key == from_prod.user_key


async def test_different_accounts_get_different_keys(verifier, keypair):
    one = await verifier.verify(make_token(keypair, sub='111'))
    two = await verifier.verify(make_token(keypair, sub='222'))
    assert one.user_key != two.user_key


def test_user_key_hides_the_subject():
    verifier = TokenVerifier(client_id=PROD_CLIENT, secret='test-secret')
    key = verifier.user_key('1234567890')
    assert '1234567890' not in key
    assert len(key) == 64


def test_user_key_depends_on_the_secret():
    subject = '1234567890'
    first = TokenVerifier(client_id=PROD_CLIENT, secret='one').user_key(subject)
    second = TokenVerifier(client_id=PROD_CLIENT, secret='two').user_key(subject)
    assert first != second


def test_empty_client_id_is_refused():
    with pytest.raises(ValueError, match='empty'):
        TokenVerifier(client_id='  ,  ', secret='test-secret')
