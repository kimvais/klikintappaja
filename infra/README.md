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

## One-time setup

```powershell
$env:PROJECT_ID = 'your-project'
$env:REGION     = 'europe-north1'

gcloud config set project $env:PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# Image repository
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
./infra/deploy.ps1 -ProjectId your-project -Region europe-north1 -Tag v0.1.0
```

## MongoDB Atlas

Created manually — the free M0 tier is enough for a prototype storing short text
documents. Network access must permit Cloud Run's egress; with the default
(no VPC connector) that means allowing `0.0.0.0/0` and relying on the database
user's credentials, or attaching a connector and allow-listing a static egress
IP. Note the irony worth remembering here: a static egress IP is also what makes
a service easy for a publisher to block, which is exactly why this design never
fetches articles server-side.
