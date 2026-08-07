# Infrastructure

Deployment for the shared-headline API in `backend/`: one Cloud Run service, one
Artifact Registry repository, two Secret Manager secrets, and a MongoDB Atlas
cluster created by hand.

## Why plain YAML and not Pulumi

Cloud Run consumes a Knative service definition directly
(`gcloud run services replace`), so `cloudrun-service.yaml` *is* declarative
infrastructure-as-code — version-controlled, reviewable, and with no state file
to store or lock. For a handful of resources that is the whole benefit of an IaC
tool without its overhead.

Pulumi earns its keep when there is state worth tracking and dependencies worth
ordering — Atlas clusters and users, DNS records, IAM bindings, several
environments. If this grows into that, the port is straightforward and the YAML
here documents exactly what needs to be expressed. Until then a second toolchain
would be a liability.

## The project

| | |
| --- | --- |
| Project ID | `klikintappaja` |
| Project number | `609693124228` |
| Created | 2026-08-07 (`gcloud projects create`) |

Billing must be linked before Cloud Run or Artifact Registry will work.

## OAuth clients

Two **Web application** clients, created at
[Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients?project=klikintappaja).
The consent screen must exist first (External, scope `openid` only, published to
Production — a *Testing* app admits only listed test users, max 100).

| | Extension ID | Authorized redirect URI |
| --- | --- | --- |
| Production | `jcdabpknfbcbcdbipfclhknoglhgecjl` | `https://jcdabpknfbcbcdbipfclhknoglhgecjl.chromiumapp.org/` |
| Development | `kajoffjdobhgpgbapccbnjhoegfadbdg` | `https://kajoffjdobhgpgbapccbnjhoegfadbdg.chromiumapp.org/` |

Leave **Authorized JavaScript origins** empty — `launchWebAuthFlow` navigates a
webview and returns via the redirect, so no JS origin is involved, and Google
rejects `chrome-extension://` values there anyway. The redirect URI must match
exactly, trailing slash included; it is what `chrome.identity.getRedirectURL()`
returns.

The development ID is derived from the absolute path of the unpacked `extension/`
directory. It is stable as long as that path is, and changes if the repo moves or
is cloned elsewhere — at which point this table and that client need updating.
(The alternative, pinning it with a `"key"` in the manifest so both builds share
the published ID, was considered and deliberately not taken.)

Both client IDs go to the service as one value; a token naming either is accepted,
and the same Google account maps to the same pseudonymous key through both:

```
GOOGLE_OAUTH_CLIENT_ID=<prod>.apps.googleusercontent.com,<dev>.apps.googleusercontent.com
```

## One-time setup

```powershell
$env:PROJECT_ID = 'klikintappaja'
$env:REGION     = 'europe-north1'

gcloud config set project $env:PROJECT_ID
# cloudbuild is needed too: deploy.ps1 builds the image with `gcloud builds submit`.
gcloud services enable run.googleapis.com artifactregistry.googleapis.com `
  secretmanager.googleapis.com cloudbuild.googleapis.com

# Image repository -> europe-north1-docker.pkg.dev/klikintappaja/klikintappaja
gcloud artifacts repositories create klikintappaja `
  --repository-format=docker --location=$env:REGION

# Runtime identity: no permissions beyond reading its own two secrets
gcloud iam service-accounts create klikintappaja-api --display-name='Klikintappaja API'

# Secrets. SERVER_SECRET is the HMAC key that pseudonymises Google subject IDs —
# rotating it invalidates every stored contributor key, so treat it as permanent.
'mongodb+srv://…' | gcloud secrets create klikintappaja-mongodb-uri --data-file=-
python -c "import secrets; print(secrets.token_urlsafe(48))" |
  gcloud secrets create klikintappaja-server-secret --data-file=-

foreach ($s in 'klikintappaja-mongodb-uri', 'klikintappaja-server-secret') {
  gcloud secrets add-iam-policy-binding $s `
    --member="serviceAccount:klikintappaja-api@$env:PROJECT_ID.iam.gserviceaccount.com" `
    --role=roles/secretmanager.secretAccessor
}
```

Then edit `cloudrun-service.yaml`, replacing `PROJECT_ID`, `REGION` and
`REPLACE_WITH_OAUTH_CLIENT_ID`.

**Unauthenticated invocation must be allowed** — the service authenticates
callers itself with Google ID tokens, and Cloud Run's own IAM check would reject
browser-extension traffic before it ever reached that code:

```powershell
gcloud run services add-iam-policy-binding klikintappaja-api `
  --region=$env:REGION --member=allUsers --role=roles/run.invoker
```

## Deploying

```powershell
./infra/deploy.ps1 -ProjectId klikintappaja -Region europe-north1 -Tag v0.1.0
```

## MongoDB Atlas

Created manually — the free M0 tier is enough for a prototype storing short text
documents. Network access must permit Cloud Run's egress; with the default
(no VPC connector) that means allowing `0.0.0.0/0` and relying on the database
user's credentials, or attaching a connector and allow-listing a static egress
IP. Note the irony worth remembering here: a static egress IP is also what makes
a service easy for a publisher to block, which is exactly why this design never
fetches articles server-side.
