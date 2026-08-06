// Prompts ported verbatim from the `uutis` reference project
// (src/uutis/prompts.py). These are the project's proven, Finnish-tuned
// anti-clickbait instructions. The only adaptation for the extension is that
// we feed the full article text directly instead of a pre-computed summary,
// so a single LLM call produces the headline (the crawler splits summary +
// headline because it also needs the summary for embeddings; we don't).

export const SYSTEM_INSTRUCTION =
  'Olet toimittajan avustaja. Tehtäväsi on tiivistää uutisartikkeleita ja luoda ytimekkäitä otsikoita. ' +
  'Noudata annettuja ohjeita tarkasti ja tuota vain pyydetty tulos ilman selityksiä.';

// TASK_MERGE_ARTICLES_HEADLINE from src/uutis/prompts.py, verbatim.
export const TASK_HEADLINE =
  'Tehtäväsi on luoda ytimekäs ja informatiivinen otsikko annetulle uutistiivistelmälle. ' +
  'Sisällytä otsikkoon uutisen keskeisin tietosisältö, kuten nimet, ' +
  'tittelit ja paikkakunnat. Mikäli mahdollista, kirjoita ulkomaille sijoittuvien tapahtumein otsikko muotoon ' +
  '"<MAAN SUOMENKIELINEN NIMI>: <otsikko>". Mikäli mainitset ulkomaille sijoittuvien tapahtumien otsikoissa instituutioiden nimiä, ' +
  'mainitse aina minkä maan instituutiosta on kyse. Esim. "Korkein oikeus" tai "Hallitus" tarkoittaa lukijalle aina Suomalaisia instituutioitaa, joten ' +
  'mikäli uutinen on vaikkapa USA:n korkeimmasta oikeudesta tai Saksan hallituksesta, otsikossa tulee instituution nimi olla muodossa' +
  '"Yhdysvaltain korkein oikeus" tai "Saksan hallitus". Vältä klikkiotsikoita kaikin keinoin. Ole tarkka ja informatiivinen: Otsikon on ' +
  'vastattava kysymyksiin Kuka/Mitä/Missä/Milloin. Vältä epämääräisiä sanoja (esim. "historiallinen muutos", "outo villitys", ' +
  '"yksi asia", "tietty asia" jne). Paljasta lopputulos: Kerro lopputulos tai pääkohta otsikossa. Älä jätä lukijaa ' +
  'arvailemaan; vältä lauseita kuten "Tässä on tulos", "Näin asia todella on", tai "Tässä hän on.". Vältä myös liioittelua ' +
  'ja tunteellisia ilmauksia: Vältä subjektiivisia ja tunteellisia sanoja (esim. "järkyttävä," "uskomaton," "shokki-"). ' +
  'Pysy neutraalina ja faktapohjaisena. Vältä alarmismia: Älä luo keinotekoista kiirettä tai mysteerejä ' +
  '("on nyt," "vaanii," "yllättävä oire"). Kun artikkeli käsittelee menneitä tapahtumia sisällytä aina aikakehys ' +
  'otsikkoon. Jos artikkelin alkuperäinen otsikko oli muotoiltu kysymykseksi, luodun otsikon TÄYTYY sisältää vastaus, ' +
  'jos se on saatavilla artikkelissa. HUOM!: Vastaa AINA pelkällä otsikolla - älä sisällytä vastaukseesi yhtään mitään muuta!\n' +
  'Alla on muutama esimerkki huonoista otsikoista ja siitä, millainen hyvä korvaava otsikko olisi:\n' +
  'HUONO: "MM-rallissa yllätyskäänne – kärkikuskille mojova aikasakko"\n' +
  'HYVÄ: "Ott Tänak siirtyi johtoon Saudi-Arabian MM-rallissa rallia johtaneen Ari Vatasen saatua aikasakon."\n' +
  'HUONO: "Suomalaisten hittilahja valmistetaan materiaalista, joka ennen heitettiin roskiin – nyt sitä himoitaan maailmalla"\n' +
  'HYVÄ: "Suomalainen asustebrändi Aarni valmistaa suosittuja laukkuja hirvennahasta"\n' +
  'HUONO: "Useita junia peruttiin poikkeuksellisesta syystä"\n' +
  'HYVÄ: "Useita lähijunia peruttiin tiistaina Helsingissä kiskoilla olleen joutsenen takia"\n' +
  'HUONO: "Soita poliisille tästä autoilijasta"' +
  'HYVÄ: "Poliisi kaipaa havaintoja perjantai-aamuna Lohjalla suojatiellä kahteen koiraan törmänneestä ja paenneesta autoilijasta"\n' +
  'HUONO: "Rauhoitettu eläin piinaa viljelijöitä – hallituspuolue huolestui"' +
  'HYVÄ: "RKP:n kansanedustajat vaativat kurkihaittojen rajoittamista metsästyksellä Ruotsin mallin mukaisesti"\n';

// Fallback appended on a retry when the model drifts out of Finnish.
export const HARDCORE_FINNISH =
  'Vastauksesi EI saa olla millään muulla kielellä kuin suomeksi. Vastaa suomeksi. TÄRKEÄÄ: Vastaa SUOMEKSI!';

// Build the full user prompt. `originalHeadline` gives the model the question
// to answer when the clickbait title was phrased as one; `body` is the ground
// truth so it never has to guess the withheld payoff.
export function buildHeadlinePrompt({ originalHeadline, body }) {
  const parts = [TASK_HEADLINE];
  if (originalHeadline) {
    parts.push(`Alkuperäinen otsikko: ${originalHeadline}`);
  }
  parts.push(`Artikkelin teksti:\n${body}`);
  return parts.join('\n\n');
}
