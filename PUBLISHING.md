# Publishing Klikintappaja

Two distribution channels, both driven by GitHub Actions:

1. **GitHub Releases** (install outside the store) — always happens on a tag.
2. **Chrome Web Store** — opt-in, once you've set up the CWS API credentials.

## Cutting a release

1. Bump the version in `extension/manifest.json` (Chrome requires a strictly
   higher version for every store upload).
2. Commit, then tag with a matching `v<version>`:
   ```
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. `extension-release.yml` validates, checks the tag matches the manifest
   version, builds the zip, and creates a GitHub Release with it attached.

### Installing from a Release (outside the Web Store)

Download `klikintappaja-extension.zip` from the Release, unzip, then
`chrome://extensions` → Developer mode → **Load unpacked**.

> **Reality check on "outside the store":** Chrome does not let regular users
> install a packaged `.crx` by double-clicking — non-store installs require
> Developer mode (load unpacked) or enterprise policy (`ExtensionInstallForcelist`
> + a self-hosted `update_url`). So for end users the practical outside-store
> path is the Release zip + load unpacked. The Web Store is the only friction-free
> install channel. Edge Add-ons and Firefox AMO are alternative stores if wanted.

## First-time Chrome Web Store setup (manual, once)

1. Register a developer account (one-time $5 fee):
   https://chrome.google.com/webstore/devconsole
2. Create a new item and upload `klikintappaja-extension.zip` manually the
   first time. Fill in the listing:
   - Description, category (News), language (Finnish).
   - Screenshots (1280×800 or 640×400) and the 128px icon (already in `icons/`).
   - **Privacy**: link `extension/PRIVACY.md` (host it, e.g. GitHub Pages or the
     raw file URL) and complete the data-use disclosures — declare that
     "website content" is sent to a third-party AI provider to perform the
     headline rewrite. Justify each host permission (the news sites + the AI
     API endpoints + storage).
3. Submit for review. After the item exists, note its **extension ID** (from the
   dashboard URL) — automated updates use it.

## Enabling automated Web Store publishing

After the item exists, wire up the Chrome Web Store API so tags auto-publish:

1. In Google Cloud Console: create a project, enable the **Chrome Web Store API**.
2. Create an **OAuth client ID** of type *Desktop app*. Note the client ID and
   secret.
3. Get a **refresh token** once (OAuth flow with scope
   `https://www.googleapis.com/auth/chromewebstore`). A common helper:
   https://github.com/fregante/chrome-webstore-upload-keys (or do the OAuth
   dance manually with the client ID/secret).
4. In the GitHub repo, add **secrets**:
   - `CWS_EXTENSION_ID`
   - `CWS_CLIENT_ID`
   - `CWS_CLIENT_SECRET`
   - `CWS_REFRESH_TOKEN`
5. Add a repository **variable** `PUBLISH_TO_CWS` = `true`.

Now every `v*` tag builds, releases on GitHub, uploads the new package to the
Web Store, and submits it for publication. Leaving `PUBLISH_TO_CWS` unset skips
the store step — the GitHub Release still happens.

> The upload step targets an **existing** item (`PUT items/{id}`). Create the
> item manually the first time (above); automation handles updates thereafter.
