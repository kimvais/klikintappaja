// Client for the shared-headline API — the "no API key" path.
//
// Signing in with Google is not about knowing who anyone is: the server keeps
// only an irreversible hash of the account, as a per-person rate-limit anchor.
// Scope is `openid` alone, so no email or profile is ever requested.
//
// Service-worker only (ES module). The content script never talks to the API.

const OAUTH_CLIENTS = {
  // Published Web Store build
  jcdabpknfbcbcdbipfclhknoglhgecjl:
    '609693124228-cf1f8bqsb4r7pcbtqbg57l805kk5ppd2.apps.googleusercontent.com',
  // Local unpacked build (ID derived from the extension/ directory path)
  kajoffjdobhgpgbapccbnjhoegfadbdg:
    '609693124228-mssooleilfnvrjb1bpi0pnceoohetu03.apps.googleusercontent.com',
};

// Each OAuth client registers exactly one redirect URI, tied to one extension
// ID, so the right client is decided by which build is running rather than by
// remembering to flip a constant.
const CLIENT_ID = OAUTH_CLIENTS[chrome.runtime.id] || '';

// Cloud Run's deterministic hostname for service + project number + region.
// Overridable from storage so a local `fastapi dev` can be pointed at.
const DEFAULT_API_BASE = 'https://klikintappaja-api-609693124228.europe-north1.run.app';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_STORAGE_KEY = 'hostedToken';
// Refresh a little early rather than discover expiry mid-request.
const EXPIRY_SKEW_MS = 60 * 1000;

let cachedToken = null; // { idToken, expiresAt }

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Read a JWT's payload without verifying it. Safe here because nothing is
// trusted on this side: the server verifies the signature, and we only want the
// nonce (to reject a token from someone else's flow) and the expiry.
function decodePayload(jwt) {
  try {
    const [, payload] = jwt.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

export function isConfigured() {
  return Boolean(CLIENT_ID);
}

export async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get({ apiBase: '' });
  return (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
}

async function storeToken(entry) {
  cachedToken = entry;
  await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: entry });
}

async function loadToken() {
  if (cachedToken) return cachedToken;
  const stored = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  cachedToken = stored[TOKEN_STORAGE_KEY] || null;
  return cachedToken;
}

function stillValid(entry) {
  return Boolean(entry && entry.idToken && entry.expiresAt - EXPIRY_SKEW_MS > Date.now());
}

// Run the OpenID Connect flow in a browser window Chrome manages for us.
// `interactive: false` reuses an existing Google session silently, which is what
// makes the token renewable without pestering the user every hour.
async function runAuthFlow(interactive) {
  if (!CLIENT_ID) {
    throw new Error(`no OAuth client registered for extension id ${chrome.runtime.id}`);
  }
  const nonce = randomNonce();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('redirect_uri', chrome.identity.getRedirectURL());
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('prompt', interactive ? 'select_account' : 'none');

  console.debug('[klikintappaja] auth request:', url.toString());
  console.debug('[klikintappaja] redirect_uri:', chrome.identity.getRedirectURL());

  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({
      url: url.toString(),
      interactive,
    });
  } catch (err) {
    // Chrome surfaces Google's refusals here rather than as a redirect: an
    // unregistered redirect_uri, or a response_type the client may not use,
    // never reach the fragment-parsing path below.
    throw new Error(`launchWebAuthFlow: ${err.message}`);
  }
  if (!redirect) throw new Error('sign-in was dismissed');
  console.debug('[klikintappaja] redirect back:', redirect);

  // The implicit flow returns everything in the fragment.
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const error = params.get('error');
  if (error) throw new Error(`Google returned ${error}`);

  const idToken = params.get('id_token');
  if (!idToken) throw new Error('no id_token in the response');

  const claims = decodePayload(idToken);
  if (!claims || claims.nonce !== nonce) {
    // A token whose nonce we did not generate belongs to some other flow.
    throw new Error('id_token nonce mismatch');
  }

  const entry = { idToken, expiresAt: (claims.exp || 0) * 1000 };
  await storeToken(entry);
  return entry;
}

export async function getIdToken({ interactive = false } = {}) {
  const existing = await loadToken();
  if (stillValid(existing)) return existing.idToken;
  try {
    const entry = await runAuthFlow(interactive);
    return entry.idToken;
  } catch (err) {
    if (interactive) throw err;
    // A silent renewal failing just means the user must sign in again.
    console.debug('[klikintappaja] silent sign-in failed:', err.message);
    return null;
  }
}

export async function signIn() {
  const entry = await runAuthFlow(true);
  return Boolean(entry.idToken);
}

export async function signOut() {
  cachedToken = null;
  await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
}

export async function isSignedIn() {
  return stillValid(await loadToken());
}

// --- API calls --------------------------------------------------------------

// `is:2000012186173` -> `is/2000012186173`, `a:<uuid>` -> `il/<uuid>`.
// Hashed fallback IDs (`u5:`) name articles on sites the API does not serve.
export function apiPathFor(articleId) {
  const [tag, ...rest] = String(articleId || '').split(':');
  const value = rest.join(':');
  if (!value) return null;
  if (tag === 'is') return `is/${value}`;
  if (tag === 'a') return `il/${value}`;
  return null;
}

async function apiFetch(path, { method = 'GET', body = null, interactive = false } = {}) {
  const token = await getIdToken({ interactive });
  if (!token) return { error: 'not-signed-in' };

  const base = await getApiBase();
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${base}/v1/headlines/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { error: `network: ${err.message}` };
  }

  if (res.status === 401) {
    // The token was rejected; drop it so the next call re-authenticates.
    await signOut();
    return { error: 'unauthorized' };
  }
  if (res.status === 404) return { error: 'not-found' };
  if (res.status === 403) return { error: 'not-approved' };
  if (res.status === 429) return { error: 'rate-limited' };
  if (!res.ok) return { error: `api ${res.status}` };
  return { data: await res.json() };
}

export async function lookupHeadline(articleId) {
  const path = apiPathFor(articleId);
  if (!path) return { error: 'unsupported-article' };
  return apiFetch(path);
}

export async function contributeHeadline(articleId, contribution) {
  const path = apiPathFor(articleId);
  if (!path) return { error: 'unsupported-article' };
  return apiFetch(path, { method: 'POST', body: contribution });
}

export async function whoami({ interactive = false } = {}) {
  return apiFetch('me', { interactive });
}
