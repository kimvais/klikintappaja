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
        paywallMode: 'dim',
      },
      (cfg) => {
        $('enabled').checked = cfg.enabled !== false;
        $('count').textContent = cfg.count || 0;
        $('paywallMode').value = cfg.paywallMode || 'dim';
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
