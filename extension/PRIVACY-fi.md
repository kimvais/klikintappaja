# Klikintappaja — tietosuojaseloste

_Päivitetty: 2026-08-07_

> Tämä on käännös. Ristiriitatilanteessa englanninkielinen
> [PRIVACY.md](PRIVACY.md) on virallinen versio.

Klikintappaja on selainlaajennus, joka lisää suomalaisten uutissivustojen
klikkiotsikoiden alle asiallisen spoileririvin. Se ei kerää **analytiikkaa
eikä telemetriaa**, eikä mitään tietoja myydä tai luovuteta
mainostarkoituksiin.

Se, mitä tietoja selaimestasi lähtee, riippuu täysin siitä, kumman tilan valitset
ponnahdusikkunan kohdasta **Otsikoiden lähde**:

| | Oma API-avain | Yhteinen tietokanta |
| --- | --- | --- |
| Google-kirjautuminen | ei tarvita | **vaaditaan** |
| Artikkelin teksti lähetetään | valitsemallesi tekoälypalvelulle | ei kenellekään |
| Palvelimellemme päätyy | ei mitään | haettavan artikkelin tunniste |

## Tila 1 — oma API-avain

Tässä tilassa mikään ylläpitämämme palvelin ei ole mukana lainkaan.

- **API-avain.** Google Geminille, Anthropic Claudelle tai OpenAI:lle syöttämäsi
  avain tallennetaan paikallisesti `chrome.storage.local`-tallennustilaan. Se ei
  poistu selaimestasi muutoin kuin pyynnöissä kyseiselle palvelulle.
- **Artikkelin teksti.** Otsikon uudelleenkirjoittamista varten laajennus hakee
  linkitetyn artikkelin ja lähettää sen tekstin sekä alkuperäisen otsikon
  valitsemallesi palvelulle. Tiedot käsitellään kyseisen palvelun ehtojen
  mukaisesti: [Gemini](https://ai.google.dev/terms),
  [Anthropic](https://www.anthropic.com/legal/privacy),
  [OpenAI](https://openai.com/policies/privacy-policy).
- **Uutissivustojen evästeet.** Artikkelihaku tehdään **sivuston omilla
  evästeilläsi** (is.fi, iltasanomat.fi, iltalehti.fi, kauppalehti.fi) täsmälleen
  kuten jos avaisit jutun itse. Juuri tämä mahdollistaa sen, että maksava IS
  Extra- tai Iltalehti Plus -tilaaja saa oikean otsikon maksumuurin sijaan.
  Evästeet menevät vain uutissivustolle — eivät koskaan tekoälypalvelulle eivätkä
  meille. Tästä seuraa yksi asia, joka on hyvä tiedostaa: jos olet tilaaja,
  tekoälypalvelulle lähetettävä teksti on tilaajille rajattua sisältöä. Jos et
  halua näin tapahtuvan, aseta **Maksumuurin takana** arvoon *Häivytä* tai
  *Piilota kokonaan* — silloin maksumuurin takaisia juttuja ei lähetetä minnekään.

## Tila 2 — yhteinen tietokanta (Google-kirjautuminen)

Otsikot haetaan muiden käyttäjien jo tuottamista. Selaimesi **ei hae artikkelia**
eikä mikään tekoälypalvelu ole mukana.

- **Mitä vastaanotamme.** Jokaista näytettävää otsikkoa varten selaimesi kysyy
  rajapinnaltamme yhtä artikkelitunnistetta (esimerkiksi `is/2000012186173`)
  Google-tunnisteen kera. Palvelun ylläpitäjä voi siis nähdä, että tietty
  pseudonyymi käyttäjä haki tiettyä artikkelia. Tämä on tilan luonteeseen
  kuuluvaa; jos et halua kenenkään voivan havaita sitä, käytä oman API-avaimen
  tilaa.
- **Mitä sinusta säilytetään.** Google-tunniste tarkistetaan ja siitä johdetaan
  peruuttamaton tiiviste tilisi tunnistenumerosta. **Vain tämä tiiviste
  tallennetaan** — ei sähköpostiosoitetta, ei nimeä, ei profiilikuvaa. Laajennus
  pyytää ainoastaan `openid`-oikeuden, joten emme edes vastaanota niitä.
  Tiivistettä käytetään käyttökertojen laskemiseen henkilöä kohden, koska palvelu
  maksetaan yhden ihmisen omasta pussista.
- **Käyttörajalaskurit** sisältävät saman tiivisteen ja aikaikkunan, ja ne
  poistuvat itsestään ikkunan umpeuduttua.
- **Rehellisyyden nimissä:** tiiviste on pysyvä ja sidoksissa tiliisi, joten se on
  *pseudonyymi* eikä anonyymi tieto. Emme tarkoituksella pysty yhdistämään sitä
  henkilöllisyyteen, mutta emme väitä sen jäävän tietosuojalainsäädännön
  ulkopuolelle.

## Tuottamiesi otsikoiden jakaminen (vapaaehtoinen, oletuksena pois)

Omaa API-avainta käyttävä voi lisäksi sallia tuottamiensa otsikoiden jakamisen.
Se edellyttää kirjautumista ja erikseen myönnettyä oikeutta. Kun jakaminen on
päällä, onnistuneen uudelleenkirjoituksen jälkeen rajapinnallemme lähetetään
otsikko **ja artikkelin teksti**.

**Artikkelin tekstiä ei tallenneta.** Sitä käytetään tiivisteen laskemiseen, joka
kertoo mitä artikkelin versiota otsikko kuvaa, minkä jälkeen teksti hylätään.
Talteen jäävät: artikkelin tunniste, otsikko, kyseinen tiiviste, otsikon
tuottanut palvelu ja malli, pseudonyymi tunnisteesi sekä aikaleima.

Maksumuurin takaisista jutuista tuotettuja otsikoita ei jaeta koskaan —
laajennus kieltäytyy lähettämästä niitä ja palvelin kieltäytyy ottamasta niitä
vastaan.

## Paikallinen tallennus

- **Välimuistissa olevat otsikot** ovat `chrome.storage.local`-tallennustilassa,
  avaimena artikkelin tunniste ja varmistuksena artikkelin tekstin tiiviste. Ne
  vanhenevat 24 tunnissa. Välimuistissa on otsikoita ja tiivisteitä, **ei
  artikkelien tekstiä**. Voit tyhjentää sen milloin tahansa ponnahdusikkunasta.
- **Kirjautumistunnisteesi** tallennetaan paikallisesti ja poistetaan, kun
  kirjaudut ulos.

## Säilytys ja poistaminen

- Paikallinen välimuisti: 24 tuntia, tai heti painikkeesta **Tyhjennä välimuisti**.
- Kirjautuminen: peruuntuu paikallisesti kirjautumalla ulos. Voit myös poistaa
  sovelluksen oikeudet
  [Google-tilisi asetuksista](https://myaccount.google.com/permissions).
- Jaetut otsikot: säilytetään toistaiseksi, koska ne ovat se yhteinen resurssi,
  jota varten palvelu on olemassa. Ne kuvaavat uutisartikkeleita, eivät ihmisiä.
  Jokaisesta merkinnästä tallentuu, kuka sen on jakanut, joten jos olet jakanut
  otsikoita ja haluat ne poistettavan, pyydä — ne voidaan poistaa.

## Missä palvelu toimii

Rajapinta toimii Google Cloud Runissa EU-alueella (`europe-north1`) ja tiedot
ovat MongoDB Atlasissa. Tunnukset säilytetään Google Secret Managerissa. Palvelua
ylläpitää projektin tekijä henkilökohtaisesti, ei yritys.

## Mitä emme tee

- Emme kerää analytiikkaa, telemetriaa emmekä selaushistoriaa.
- Ei mainontaa, ei profilointia, ei tietojen myyntiä tai luovuttamista.
- Emme tallenna artikkelien tekstiä palvelimellemme.
- Emme kerää sähköpostiosoitettasi emmekä nimeäsi.

## Lähdekoodi

Laajennus ja palvelin ovat avointa lähdekoodia MIT-lisenssillä, joten jokaisen
tässä esitetyn väitteen voi tarkistaa koodista:
https://github.com/kimvais/klikintappaja

## Yhteystiedot

Avaa issue projektin GitHub-repositoriossa.
