"""Endpoint behaviour, weighted towards the ways it should refuse."""

from fastapi.testclient import TestClient

from klikintappaja_api.articles import content_hash
from tests.conftest import BODY, CONTRIBUTOR_KEY, FakeDatabase, make_headline

IS_PATH = '/v1/headlines/is/2000012186173'
IL_PATH = '/v1/headlines/il/1ee556a4-b80a-4199-8d45-88b5870f4330'


def contribution(**overrides) -> dict:
    payload = {
        'headline': 'Ministeri kertoi budjettileikkauksista tiistaina',
        'body': BODY,
        'provider': 'gemini',
        'model': 'gemini-2.5-flash-lite',
        'original_headline': 'Tämä yksi asia paljastui - et usko mitä tapahtui',
    }
    payload.update(overrides)
    return payload


# --- refusals ---------------------------------------------------------------


def test_read_without_token_is_unauthorized(client: TestClient):
    response = client.get(IS_PATH)
    assert response.status_code == 401
    assert response.headers['WWW-Authenticate'] == 'Bearer'


def test_read_with_bad_token_is_unauthorized(client: TestClient):
    response = client.get(IS_PATH, headers={'Authorization': 'Bearer forged'})
    assert response.status_code == 401


def test_non_bearer_authorization_is_unauthorized(client: TestClient):
    response = client.get(IS_PATH, headers={'Authorization': 'Basic aGk6dGhlcmU='})
    assert response.status_code == 401


def test_unknown_article_is_not_found(client: TestClient, auth: dict):
    assert client.get(IS_PATH, headers=auth).status_code == 404


def test_unknown_site_is_not_found(client: TestClient, auth: dict):
    assert client.get('/v1/headlines/hs/2000012186173', headers=auth).status_code == 404


def test_malformed_id_is_not_found(client: TestClient, auth: dict):
    assert client.get('/v1/headlines/is/not-a-number', headers=auth).status_code == 404


def test_contributing_without_approval_is_forbidden(client: TestClient, auth: dict):
    response = client.post(IS_PATH, json=contribution(), headers=auth)
    assert response.status_code == 403


def test_paywalled_contribution_is_rejected(client: TestClient, contributor: dict, db: FakeDatabase):
    response = client.post(IS_PATH, json=contribution(paywalled=True), headers=contributor)
    assert response.status_code == 400
    assert 'paywalled' in response.json()['detail']
    assert db.headlines == {}


def test_thin_body_is_rejected(client: TestClient, contributor: dict):
    response = client.post(IS_PATH, json=contribution(body='too short'), headers=contributor)
    assert response.status_code == 400


def test_oversized_headline_is_rejected(client: TestClient, contributor: dict):
    response = client.post(IS_PATH, json=contribution(headline='x' * 301), headers=contributor)
    assert response.status_code == 422


def test_quota_exhaustion_is_reported(client: TestClient, auth: dict, db: FakeDatabase):
    db.headlines['is:2000012186173'] = make_headline()
    db.quota_limit_override = 2
    assert client.get(IS_PATH, headers=auth).status_code == 200
    assert client.get(IS_PATH, headers=auth).status_code == 200
    throttled = client.get(IS_PATH, headers=auth)
    assert throttled.status_code == 429
    assert 'Retry-After' in throttled.headers


# --- the happy paths --------------------------------------------------------


def test_contribute_then_read(client: TestClient, contributor: dict, auth: dict):
    posted = client.post(IL_PATH, json=contribution(), headers=contributor)
    assert posted.status_code == 200
    assert posted.json()['id'] == 'a:1ee556a4-b80a-4199-8d45-88b5870f4330'
    assert posted.json()['sha'] == content_hash(BODY)

    fetched = client.get(IL_PATH, headers=auth)
    assert fetched.status_code == 200
    assert fetched.json()['headline'] == contribution()['headline']


def test_etag_round_trip_yields_304(client: TestClient, contributor: dict, auth: dict):
    client.post(IS_PATH, json=contribution(), headers=contributor)
    first = client.get(IS_PATH, headers=auth)
    etag = first.headers['ETag']
    assert etag == f'"{content_hash(BODY)}"'

    again = client.get(IS_PATH, headers={**auth, 'If-None-Match': etag})
    assert again.status_code == 304
    assert again.content == b''


def test_resubmitting_identical_body_is_idempotent(client: TestClient, contributor: dict, db: FakeDatabase):
    first = client.post(IS_PATH, json=contribution(), headers=contributor)
    second = client.post(IS_PATH, json=contribution(headline='A different wording'), headers=contributor)
    assert second.json()['generated_at'] == first.json()['generated_at']
    # Same article text means the stored headline stands; the second wording is
    # ignored rather than churning the entry.
    assert db.headlines['is:2000012186173'].headline == contribution()['headline']


def test_edited_article_replaces_the_headline(client: TestClient, contributor: dict, db: FakeDatabase):
    client.post(IS_PATH, json=contribution(), headers=contributor)
    updated_body = BODY + ' Myöhemmin illalla ministeri täsmensi kantaansa uudelleen.'
    response = client.post(
        IS_PATH,
        json=contribution(body=updated_body, headline='Ministeri täsmensi kantaansa illalla'),
        headers=contributor,
    )
    assert response.json()['sha'] == content_hash(updated_body)
    assert db.headlines['is:2000012186173'].headline == 'Ministeri täsmensi kantaansa illalla'


def test_contribution_records_provenance(client: TestClient, contributor: dict, db: FakeDatabase):
    client.post(IS_PATH, json=contribution(), headers=contributor)
    stored = db.headlines['is:2000012186173']
    assert stored.contributor == CONTRIBUTOR_KEY
    assert stored.provider == 'gemini'


async def test_purge_removes_only_that_contributors_work(db: FakeDatabase):
    db.headlines['is:1'] = make_headline('is:1', contributor=CONTRIBUTOR_KEY)
    db.headlines['is:2'] = make_headline('is:2', contributor='someone-else')
    assert await db.purge_contributions(CONTRIBUTOR_KEY) == 1
    assert set(db.headlines) == {'is:2'}


# --- ops --------------------------------------------------------------------


def test_healthz_is_open(client: TestClient):
    assert client.get('/healthz').status_code == 200


def test_healthz_reports_database_trouble(client: TestClient, db: FakeDatabase):
    db.ping_fails = True
    assert client.get('/healthz').status_code == 503
