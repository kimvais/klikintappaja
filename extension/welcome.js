// The page shown once, on install. It handles only the first decision a new
// user has to make — where headlines come from, and signing in if that is the
// shared store. Everything else stays in the popup rather than being duplicated
// here.

const $ = (id) => document.getElementById(id);

function showMode(mode) {
  $('hostedBox').style.display = mode === 'hosted' ? '' : 'none';
  $('keyBox').style.display = mode === 'hosted' ? 'none' : '';
  if (mode === 'hosted') refreshAuth();
}

function refreshAuth() {
  chrome.runtime.sendMessage({ type: 'authStatus' }, (reply) => {
    const state = $('state');
    if (!reply || reply.error) {
      state.textContent = 'Kirjautumisen tila ei selvinnyt.';
      return;
    }
    if (!reply.configured) {
      state.textContent =
        'Tälle asennukselle ei ole rekisteröityä OAuth-asiakasta (' + chrome.runtime.id + ').';
      return;
    }
    if (!reply.signedIn) {
      state.textContent = 'Et ole kirjautunut.';
      return;
    }
    if (reply.apiError) {
      state.textContent = 'Kirjautunut, mutta palvelimeen ei saada yhteyttä: ' + reply.apiError;
      return;
    }
    state.textContent = reply.contributor
      ? 'Kirjautunut. Sinulla on oikeus jakaa otsikoita.'
      : 'Kirjautunut. Otsikot haetaan yhteisestä tietokannasta.';
  });
}

$('mode').addEventListener('change', () => {
  const mode = $('mode').value;
  chrome.storage.local.set({ mode });
  showMode(mode);
});

$('signIn').addEventListener('click', () => {
  $('state').textContent = 'Kirjaudutaan…';
  chrome.runtime.sendMessage({ type: 'signIn' }, (reply) => {
    if (reply && reply.error) {
      $('state').textContent = 'Kirjautuminen epäonnistui: ' + reply.error;
      return;
    }
    refreshAuth();
  });
});

$('signOut').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'signOut' }, () => refreshAuth());
});

chrome.storage.local.get({ mode: 'hosted' }, (cfg) => {
  const mode = cfg.mode === 'key' ? 'key' : 'hosted';
  $('mode').value = mode;
  showMode(mode);
});
