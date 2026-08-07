# Klikintappaja API

A community-powered store of de-clickbaited headlines. Extension users who bring
their own LLM key can opt in to share what they generate; everyone else signs in
with Google and reads that pool — no API key, no unpacked install.

**The server never calls a model.** Contributors send finished headlines, so there
is no LLM SDK here and no inference bill. Running cost is Cloud Run's scale-to-zero
plus a MongoDB Atlas free tier.

## Endpoints

Every request needs `Authorization: Bearer <google-id-token>`.

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/v1/headlines/{site}/{id}` | any signed-in user |
| `POST` | `/v1/headlines/{site}/{id}` | approved contributors only |
| `GET` | `/healthz` | open |

`{site}` is `is` or `il`; `{id}` is the publication's own article ID
(`/v1/headlines/is/2000012186173`, `/v1/headlines/il/1ee556a4-…`). These map to
the tagged IDs the extension derives in `extension/articleid.js`.

```jsonc
// 200 OK, ETag: "5cbf29a70ee4c1f2"
{
  "id": "is:2000012186173",
  "headline": "Ministeri kertoi budjettileikkauksista tiistaina",
  "sha": "5cbf29a70ee4c1f2",
  "model": "gemini-2.5-flash-lite",
  "generated_at": "2026-08-07T12:00:00Z"
}
```

`sha` fingerprints the article body the headline was written from. It is returned,
never queried on, and doubles as the `ETag` — so a client can revalidate with
`If-None-Match` and get a `304`. Unlike the publishers' own ETags this one tracks
the article text: measured against live articles, `is.fi` rotates its ETag on
content that never changed and `iltalehti.fi` sends none at all.

## Design notes

**Google sign-in is a rate-limit anchor, not an identity.** The ID token is
verified offline and reduced to `HMAC(sub, SERVER_SECRET)`. Nothing else is kept —
no email, no name, no raw subject — and the client requests scope `openid` only,
so none of it is ever received.

**Article text is never stored.** A contribution's body is hashed and discarded;
only the headline and its fingerprint persist.

**Clients send bodies; the server never fetches articles.** A datacentre IP
crawling `is.fi` would be easy for the publishers to block, whereas bodies
arriving from real users' browsers are not. The cost of that choice is that a
contributor could submit text that is not the article, so writes are restricted to
an allowlist and every document records who supplied it — abuse is traceable and
purgeable rather than prevented.

**Paywalled articles are refused.** A subscriber must not feed IS Extra or
Iltalehti Plus text into a pool served to non-subscribers.

## Development

```powershell
uv sync --all-extras --dev

$env:MONGODB_URI            = 'mongodb+srv://…'
$env:SERVER_SECRET          = 'anything-stable-locally'
$env:GOOGLE_OAUTH_CLIENT_ID = '….apps.googleusercontent.com'

uv run pytest -q            # 34 tests; needs `node` on PATH for one of them
uv run ruff check .
uv run fastapi dev src/klikintappaja_api/__init__.py
```

The suite uses an in-memory double for MongoDB, so no database is needed to run
it. One test shells out to `node` to compare this package's `content_hash()`
against `contentHash()` in `extension/articleid.js`: if those two ever disagree,
clients would look up fingerprints the server never stores and the shared cache
would quietly stop matching, with no error anywhere.

## Administration

Contributors are managed from the command line — the only privileged operation
here, and too rare to justify a UI.

```powershell
uv run klikintappaja-api-tool approve-user <user_key> --note 'who this is'
uv run klikintappaja-api-tool ban-user <user_key>
uv run klikintappaja-api-tool purge-contributions <user_key>
```

`<user_key>` is the pseudonymous HMAC, which the extension displays for the
signed-in account.

## Deployment

See [`../infra/`](../infra/) — Cloud Run service definition, secrets and the
deploy script.
