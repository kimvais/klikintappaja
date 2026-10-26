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
  $('openrouterBox').style.display = id === 'openrouter' ? '' : 'none';
  $('ollamaBox').style.display = id === 'ollama' ? '' : 'none';
  $('keyFields').style.display = info.needsKey === false ? 'none' : '';
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
        keys: {},
        models: {},
        count: 0,
        paywallMode: 'hide',
        displayMode: 'rewrite-original',
        dimSkipped: false,
        hideAds: true,
      },
      (cfg) => {
        $('enabled').checked = cfg.enabled !== false;
        $('count').textContent = cfg.count || 0;
        $('paywallMode').value = cfg.paywallMode || 'hide';
        $('displayMode').value = ['rewrite', 'spoiler', 'iltasaatana'].includes(cfg.displayMode)
          ? cfg.displayMode
          : 'rewrite-original';
        $('dimSkipped').checked = cfg.dimSkipped === true;
        $('hideAds').checked = cfg.hideAds !== false;
        keys = cfg.keys || {};
        models = cfg.models || {};
        sel.value = (reply && reply.active) || DEFAULT_PROVIDER;
        showProvider(sel.value);
      }
    );
  });
}

$('provider').addEventListener('change', () => {
  // stash edits for the previous provider isn't needed — save writes them.
  showProvider($('provider').value);
});

// The popup usually closes while the sign-in window is open; the worker stores
// the key either way, and the next init() picks it up.
$('connect').addEventListener('click', () => {
  $('status').textContent = 'Kirjaudutaan…';
  chrome.runtime.sendMessage({ type: 'connectOpenRouter' }, (reply) => {
    if (reply && reply.error) {
      $('status').textContent = 'Kirjautuminen epäonnistui: ' + reply.error;
      return;
    }
    flash('Yhdistetty OpenRouteriin.');
    init();
  });
});

$('enabled').addEventListener('change', () => {
  chrome.storage.local.set({ enabled: $('enabled').checked });
});

// Applied immediately: the content script re-treats already-marked teasers on
// change, so there is no need to reload the page.
$('paywallMode').addEventListener('change', () => {
  chrome.storage.local.set({ paywallMode: $('paywallMode').value });
});

$('displayMode').addEventListener('change', () => {
  chrome.storage.local.set({ displayMode: $('displayMode').value });
});

// Applied live like the paywall setting: already-processed teasers are re-treated.
$('dimSkipped').addEventListener('change', () => {
  chrome.storage.local.set({ dimSkipped: $('dimSkipped').checked });
});

$('hideAds').addEventListener('change', () => {
  chrome.storage.local.set({ hideAds: $('hideAds').checked });
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
      displayMode: $('displayMode').value,
      dimSkipped: $('dimSkipped').checked,
      hideAds: $('hideAds').checked,
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
