# Publishing Klikintappaja

Three distribution channels, all driven by GitHub Actions:

1. **GitHub Releases** (install outside the store) — always happens on a tag.
2. **Chrome Web Store** — opt-in, once you've set up the CWS API credentials.
3. **Microsoft Edge Add-ons** — opt-in, same zip, separate credentials.

**Brave, Vivaldi and other Chromium forks need no separate publishing** — they
have no store of their own and install straight from the Chrome Web Store.

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

> **Why we don't build a `.crx`:** both stores take the **zip** and sign it
> themselves, so a `.crx` is not a publishing artifact. And per Chrome's own
> docs, *"Linux is the only platform where Chrome users can install extensions
> that are hosted outside of the Chrome Web Store"* — a self-hosted `.crx` plus
> `update_url` cannot serve Windows or macOS users at all.

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

## Microsoft Edge Add-ons

Edge accepts the **same `klikintappaja-extension.zip`** — no manifest changes, no
separate build. It's a genuinely separate listing though: its own product ID,
its own review, its own store page.

Expect **up to seven business days** for certification (Microsoft's documented
figure), so this is not necessarily faster than Chrome — it's a second audience,
not a shortcut. Declaring **no remote code** matters here: remote code triggers
additional review and longer certification, and this extension has none (see the
"not remote code" invariant in `CLAUDE.md`).

### First-time setup (manual, once)

1. Register at [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/public/login)
   under the Microsoft Edge program — see
   [Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account).
   There is **no registration fee** (unlike Chrome's one-time $5).

   > **Use a personal Microsoft account, not a work/school one.** The Edge
   > program *"doesn't support registering with a work or school account"* — the
   > Primary Owner must be an MSA (`outlook.com` / `live.com` / `hotmail.com`),
   > or a GitHub account, which mints an MSA for you. Signing in with a work
   > identity (`you@company.com`, `*.onmicrosoft.com`) gets you a bare **"you
   > don't have permission to access this page"** — the Edge program simply
   > isn't enrolled for that account. Sign out fully (or use a private window)
   > before signing in with the MSA. An Entra tenant can be *linked afterwards*
   > to add colleagues as users; it just can't own the account.

   > **Two enrollment choices are permanent.** **Account type** (Individual vs
   > Company) cannot be changed later — Company → Individual is explicitly
   > unsupported — and **country/region** becomes read-only. Pick **Individual**
   > unless you need the registered business name: Company verification takes
   > "a few days to a few weeks", needs a company approver Microsoft phones, and
   > may require legal documents. Individual only checks that the publisher
   > display name is free.
2. Find the create button: Partner Center **Home** → **Workspaces** → the
   **Edge** card → the Edge **Overview** page → **⊕ Create new extension**. It is
   *not* on the Partner Center home dashboard. (No button there at all usually
   means enrollment verification is still *Pending* / *Action Required* — check
   via **Open Account Settings**.)
3. Upload the zip → fill in the listing. Things that differ from the Chrome
   dashboard:
   - **Description** must be **250–10 000 characters** (Chrome has no such floor).
   - **Privacy** page: state the single purpose, justify every permission,
     answer **"Are you using remote code?"** with *No*, complete the data-use
     disclosures, and give a reachable **Privacy policy URL** (host
     `extension/PRIVACY.md`, e.g. via GitHub Pages or its raw URL).
   - Promo tiles are the same sizes we already have in `store/`
     (440×280, 1400×560) and screenshots must be 640×480 or 1280×800 — our
     1280×800 shot fits.
   > **If "Create new extension" navigates to `undefined` and reloads** (or shows
   > *"Something went wrong… correlationId : undefined"*), that's a long-standing
   > Partner Center bug, not your package — see the cluster of issues #353, #418,
   > #445, #453, #473 in
   > [microsoft/MicrosoftEdge-Extensions](https://github.com/microsoft/MicrosoftEdge-Extensions/issues).
   > Open DevTools → Network and click the button: the failing request carries the
   > real error the UI hides. **401/403** = the Edge program enrollment isn't
   > actually provisioned (cf. #633, #390) or the account is policy-flagged
   > (Microsoft won't say why — Policy 1.2.2); **500** = server-side; **no request
   > at all** = an ad blocker or privacy extension is eating the XHR. Try
   > InPrivate, cleared cookies for `partner.microsoft.com`, and another browser
   > first; then escalate on that GitHub tracker (more responsive than Partner
   > Center tickets, per #390) with the status, response body and your Partner ID.
4. Submit. Once the product exists, copy its **product ID** (a GUID) from the
   **Extension overview** page, under **Extension identity** — it is also the
   GUID in the address bar between `microsoftedge/` and `/packages`. Automated
   updates need it.

### Enabling automated Edge publishing

1. In Partner Center → **Microsoft Edge** → **Publish API**, click **Enable**
   next to "enable the new experience" to get the **v1.1** (API-key) flow, then
   **Create API credentials**. Note the **Client ID** and **API key**.
   API keys carry an **expiry date** — publishing starts failing with 401 when
   one lapses, so renew it there and update the secret.
2. Add GitHub **secrets**:
   - `EDGE_PRODUCT_ID` — the product GUID
   - `EDGE_CLIENT_ID`
   - `EDGE_API_KEY`
3. Add a repository **variable** `PUBLISH_TO_EDGE` = `true`.

The step then uploads the zip, polls the upload operation until it leaves
`InProgress`, submits the draft for certification with the tag name as the
certification note, and polls the publish operation. Any `Failed` status is
surfaced as a GitHub error annotation with the API's `message` and `errorCode`,
and the job stops before submitting.

> Like the Web Store, this API can only **update an existing product** — there is
> no endpoint for creating a product or editing listing metadata. Do the first
> submission by hand (above).
>
> The two store steps are independent (`!cancelled()`), so a Chrome Web Store
> failure doesn't skip the Edge upload. Leaving `PUBLISH_TO_EDGE` unset skips it
> entirely.
>
> This uses **v1.1** of the Update REST API. v1 (access tokens via
> `login.microsoftonline.com`) was retired at the end of 2024 — if you find an
> older recipe using `client_secret` + an access-token URL, it's the dead one.
