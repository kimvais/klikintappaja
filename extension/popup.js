const $ = (id) => document.getElementById(id);

let PROVIDERS = {}; // {id: {label, defaultModel, keyHint}}
let DEFAULT_PROVIDER = 'gemini';
let keys = {}; // {provider: key}
let models = {}; // {provider: model}

function flash(text) {
  $('status').textContent = text;
  setTimeout(() => ($('status').textContent = ''), 1500);
}

// Reflect the fields for the currently-selected provider.
function showProvider(id) {
  const info = PROVIDERS[id] || {};
  $('apiKey').value = keys[id] || '';
  $('apiKey').placeholder = info.keyHint || '';
  $('keyHint').textContent = info.keyHint ? 'Avain: ' + info.keyHint : '';
  $('model').value = models[id] || info.defaultModel || '';
  $('model').placeholder = info.defaultModel || '';
}

// Show only the settings that apply to the chosen source. The sign-in controls
// are also needed in key mode once sharing is on: contributing requires a Google
// account, and hiding the buttons there would leave no way to provide one.
function showMode(mode) {
  const needsAuth = mode === 'hosted' || $('shareHeadlines').checked;
  $('hostedBox').style.display = needsAuth ? '' : 'none';
  $('keyBox').style.display = mode === 'hosted' ? 'none' : '';
  if (needsAuth) refreshAuth();
}

// Ask the worker who we are. The pseudonymous key is shown because that is what
// a would-be contributor has to quote to be approved — nobody, including the
// user, can derive it from their account.
function refreshAuth() {
  chrome.runtime.sendMessage({ type: 'authStatus' }, (reply) => {
    const state = $('authState');
    const key = $('userKey');
    if (!reply || reply.error) {
      state.textContent = 'Kirjautuminen epäonnistui';
      key.textContent = (reply && reply.error) || '';
      return;
    }
    if (!reply.configured) {
      state.textContent = 'Tälle asennukselle ei ole OAuth-asiakasta';
      key.textContent = chrome.runtime.id;
      return;
    }
    if (!reply.signedIn) {
      state.textContent = 'Ei kirjautunut';
      key.textContent = '';
      return;
    }
    if (reply.apiError) {
      state.textContent = 'Kirjautunut, mutta palvelin ei vastaa';
      key.textContent = reply.apiError;
      return;
    }
    state.textContent = reply.contributor ? 'Kirjautunut (jakaja)' : 'Kirjautunut';
    key.textContent = reply.userKey ? 'Tunniste: ' + reply.userKey : '';
  });
}

function init() {
  chrome.runtime.sendMessage({ type: 'providers' }, (reply) => {
    PROVIDERS = (reply && reply.providers) || {};
    DEFAULT_PROVIDER = (reply && reply.default) || 'gemini';

    const sel = $('provider');
    sel.innerHTML = '';
    for (const [id, info] of Object.entries(PROVIDERS)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = info.label;
      sel.appendChild(opt);
    }

    chrome.storage.local.get(
      {
        enabled: true,
        provider: DEFAULT_PROVIDER,
        keys: {},
        models: {},
        count: 0,
        paywallMode: 'hide',
        mode: 'hosted',
        shareHeadlines: false,
      },
      (cfg) => {
        $('enabled').checked = cfg.enabled !== false;
        $('count').textContent = cfg.count || 0;
        $('paywallMode').value = cfg.paywallMode || 'hide';
        $('mode').value = cfg.mode === 'key' ? 'key' : 'hosted';
        $('shareHeadlines').checked = cfg.shareHeadlines === true;
        showMode($('mode').value);
        keys = cfg.keys || {};
        models = cfg.models || {};
        sel.value = PROVIDERS[cfg.provider] ? cfg.provider : DEFAULT_PROVIDER;
        showProvider(sel.value);
      }
    );
  });
}

$('provider').addEventListener('change', () => {
  // stash edits for the previous provider isn't needed — save writes them.
  showProvider($('provider').value);
});

$('enabled').addEventListener('change', () => {
  chrome.storage.local.set({ enabled: $('enabled').checked });
});

// Applied immediately: the content script re-treats already-marked teasers on
// change, so there is no need to reload the page.
$('paywallMode').addEventListener('change', () => {
  chrome.storage.local.set({ paywallMode: $('paywallMode').value });
});

$('mode').addEventListener('change', () => {
  const mode = $('mode').value;
  chrome.storage.local.set({ mode });
  showMode(mode);
});

// Sharing is off by default and stays an explicit choice; nothing is contributed
// until this is ticked.
$('shareHeadlines').addEventListener('change', () => {
  chrome.storage.local.set({ shareHeadlines: $('shareHeadlines').checked });
  showMode($('mode').value); // sharing needs an account, so reveal sign-in
});

$('signIn').addEventListener('click', () => {
  $('authState').textContent = 'Kirjaudutaan…';
  chrome.runtime.sendMessage({ type: 'signIn' }, (reply) => {
    if (reply && reply.error) {
      // Show the actual reason: "redirect_uri_mismatch" and "the flow is
      // blocked for this client" need completely different fixes, and a generic
      // failure message hides which one happened.
      $('authState').textContent = 'Kirjautuminen epäonnistui';
      $('userKey').textContent = reply.error;
      return;
    }
    refreshAuth();
  });
});

$('signOut').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'signOut' }, () => {
    flash('Kirjauduttu ulos.');
    refreshAuth();
  });
});

$('save').addEventListener('click', () => {
  const provider = $('provider').value;
  const info = PROVIDERS[provider] || {};
  keys[provider] = $('apiKey').value.trim();
  models[provider] = $('model').value.trim() || info.defaultModel || '';
  chrome.storage.local.set(
    {
      provider,
      keys,
      models,
      enabled: $('enabled').checked,
      paywallMode: $('paywallMode').value,
      mode: $('mode').value,
      shareHeadlines: $('shareHeadlines').checked,
    },
    () => flash('Tallennettu.')
  );
});

$('clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearCache' }, (reply) => {
    $('count').textContent = '0';
    flash('Välimuisti tyhjennetty (' + ((reply && reply.cleared) || 0) + ').');
  });
});

init();
