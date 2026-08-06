# Builds a distributable zip of the Klikintappaja extension.
# Usage:  pwsh ./build.ps1        (from the repo root, or anywhere)
#
# Zips the CONTENTS of extension/ (so manifest.json sits at the archive root,
# which is what Chrome's "Load unpacked" and the Web Store both expect).

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $root 'extension'
$dst = Join-Path $root 'klikintappaja-extension.zip'

if (-not (Test-Path $src)) {
    throw "extension/ folder not found at $src"
}

if (Test-Path $dst) { Remove-Item $dst -Force }

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dst -CompressionLevel Optimal

$sizeKB = [math]::Round((Get-Item $dst).Length / 1KB, 1)
Write-Output "Built $dst ($sizeKB KB)"
