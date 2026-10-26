# Klikintappaja — tietosuojaseloste

_Päivitetty: 2026-10-25_

> Tämä on käännös. Ristiriitatilanteessa englanninkielinen
> [PRIVACY.md](PRIVACY.md) on virallinen versio.

Klikintappaja on selainlaajennus, joka korvaa suomalaisten uutissivustojen
klikkiotsikot asiallisilla. Se ei kerää **analytiikkaa eikä telemetriaa**, eikä
mitään tietoja myydä tai luovuteta mainostarkoituksiin. **Meillä ei ole
palvelinta**: kaikki tapahtuu selaimessasi, omalla tekoälypalvelun
API-avaimellasi.

## Mitä selaimestasi lähtee

- **API-avain.** Google Geminille, Anthropic Claudelle tai OpenAI:lle syöttämäsi
  avain, tai OpenRouterin kirjautumisen yhteydessä myöntämä avain, tallennetaan
  paikallisesti `chrome.storage.local`-tallennustilaan. Se ei poistu
  selaimestasi muutoin kuin pyynnöissä kyseiselle palvelulle.
- **OpenRouter-kirjautuminen.** Jos valitset *Kirjaudu OpenRouteriin*,
  kirjautuminen tapahtuu OpenRouterin omalla sivustolla; laajennus ei näe
  salasanaasi. Se saa ainoastaan API-avaimen OpenRouter-tilillesi.
- **Artikkelin teksti.** Otsikon uudelleenkirjoittamista varten laajennus hakee
  linkitetyn artikkelin ja lähettää sen tekstin sekä alkuperäisen otsikon
  valitsemallesi palvelulle. Tiedot käsitellään kyseisen palvelun ehtojen
  mukaisesti: [OpenRouter](https://openrouter.ai/privacy),
  [Gemini](https://ai.google.dev/terms),
  [Anthropic](https://www.anthropic.com/legal/privacy),
  [OpenAI](https://openai.com/policies/privacy-policy). OpenRouter välittää
  pyynnön käyttämäsi mallin tekijälle (oletuksena Anthropicille), joten
  OpenRouteria käytettäessä teksti päätyy molemmille. **Ollamaa** käytettäessä
  malli toimii omalla koneellasi (`localhost`), eikä artikkelin teksti poistu
  koneelta lainkaan.
- **Uutissivustojen evästeet.** Artikkelihaku tehdään **sivuston omilla
  evästeilläsi** (is.fi, iltasanomat.fi, iltalehti.fi, kauppalehti.fi) täsmälleen
  kuten jos avaisit jutun itse. Juuri tämä mahdollistaa sen, että maksava IS
  Extra- tai Iltalehti Plus -tilaaja saa oikean otsikon maksumuurin sijaan.
  Evästeet menevät vain uutissivustolle — eivät koskaan tekoälypalvelulle eivätkä
  meille. Tästä seuraa yksi asia, joka on hyvä tiedostaa: jos olet tilaaja,
  tekoälypalvelulle lähetettävä teksti on tilaajille rajattua sisältöä. Jos et
  halua näin tapahtuvan, aseta **Maksumuurin takana** arvoon *Häivytä* tai
  *Piilota kokonaan* — silloin maksumuurin takaisia juttuja ei lähetetä minnekään.

## Paikallinen tallennus

**Välimuistissa olevat otsikot** ovat `chrome.storage.local`-tallennustilassa,
avaimena artikkelin tunniste ja varmistuksena artikkelin tekstin tiiviste. Ne
vanhenevat 24 tunnissa. Välimuistissa on otsikoita ja tiivisteitä, **ei
artikkelien tekstiä**. Voit tyhjentää sen milloin tahansa ponnahdusikkunan
painikkeesta **Tyhjennä välimuisti**.

## Mitä emme tee

- Meillä ei ole palvelinta eikä käyttäjätilejä.
- Emme kerää analytiikkaa, telemetriaa emmekä selaushistoriaa.
- Ei mainontaa, ei profilointia, ei tietojen myyntiä tai luovuttamista.

## Lähdekoodi

Laajennus on avointa lähdekoodia MIT-lisenssillä, joten jokaisen tässä esitetyn
väitteen voi tarkistaa koodista: https://github.com/kimvais/klikintappaja

## Yhteystiedot

Avaa issue projektin GitHub-repositoriossa.
