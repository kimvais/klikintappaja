# Builds the API image, pushes it to Artifact Registry and applies the Cloud Run
# service definition.
#
# Usage:  ./infra/deploy.ps1 -ProjectId my-project -Region europe-north1 -Tag v0.1.0
#
# See infra/README.md for the one-time project setup this assumes.

param(
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [string]$Region = 'europe-north1',
    [string]$Tag = 'latest',
    [string]$OAuthClientId = $env:GOOGLE_OAUTH_CLIENT_ID
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$image = "$Region-docker.pkg.dev/$ProjectId/klikintappaja/api:$Tag"

if (-not $OAuthClientId) {
    throw 'Pass -OAuthClientId or set GOOGLE_OAUTH_CLIENT_ID; the API needs it to know which audience ID tokens must carry.'
}

Write-Output "Building $image"
gcloud builds submit (Join-Path $root 'backend') --tag $image --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'image build failed' }

# Render the service definition; the checked-in file keeps placeholders so it
# never carries a project ID or client ID into git.
$manifest = Get-Content (Join-Path $root 'infra/cloudrun-service.yaml') -Raw
$manifest = $manifest.Replace('PROJECT_ID', $ProjectId).
    Replace('REGION', $Region).
    Replace('IMAGE_TAG', $Tag).
    Replace('REPLACE_WITH_OAUTH_CLIENT_ID', $OAuthClientId)

$rendered = Join-Path ([System.IO.Path]::GetTempPath()) "klikintappaja-service-$Tag.yaml"
Set-Content -Path $rendered -Value $manifest -Encoding UTF8

try {
    Write-Output "Applying service definition"
    gcloud run services replace $rendered --region $Region --project $ProjectId
    if ($LASTEXITCODE -ne 0) { throw 'service replace failed' }
}
finally {
    Remove-Item $rendered -Force -ErrorAction SilentlyContinue
}

$url = gcloud run services describe klikintappaja-api --region $Region --project $ProjectId --format 'value(status.url)'
Write-Output "Deployed: $url"
Write-Output "Checking health…"
Invoke-RestMethod "$url/healthz" | ConvertTo-Json -Compress
