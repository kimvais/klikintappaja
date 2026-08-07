# Muutosloki

Kaikki huomionarvoiset muutokset kirjataan tähän tiedostoon. Versionumerot ovat
samat kuin `extension/manifest.json`-tiedostossa, ja jokainen julkaisu vastaa
`v<versio>`-tagia.

## 0.2.0 — 2026-08-07

Iso muutos: laajennuksen voi nyt ottaa käyttöön **ilman omaa API-avainta**.

### Lisätty

- **Yhteinen otsikkotietokanta.** Uusi asetus *Otsikoiden lähde* valitsee, mistä
  otsikot tulevat: yhteisestä tietokannasta (kirjautuminen Google-tilillä) vai
  omalla API-avaimella tuotettuna. Yhteisessä tilassa artikkelia ei haeta eikä
  tekoälyä kutsuta lainkaan — otsikko haetaan artikkelin tunnisteella.
- **Kirjautuminen Google-tilillä.** Palvelin ei tallenna sähköpostia, nimeä eikä
  sitä, mitä juttuja luet: Google-tilistä säilötään vain peruuttamaton tiiviste,
  jota käytetään käyttörajan tunnisteena. Laajennus pyytää pelkän
  `openid`-oikeuden.
- **Otsikoiden jakaminen.** Omaa avainta käyttävä voi erikseen sallia, että
  hänen tuottamansa otsikot tallentuvat yhteiseen tietokantaan muiden
  hyödyksi. Oletuksena pois päältä, ja vaatii erikseen myönnetyn oikeuden.
  Maksumuurin takaisista jutuista tuotettuja otsikoita ei jaeta koskaan.
- **Aloitussivu**, joka avautuu kerran asennuksen yhteydessä ja kertoo, mistä
  valita otsikoiden lähde.
- **Taustapalvelu** (`backend/`): FastAPI, MongoDB Atlas ja Google Cloud Run.
  Palvelin ei kutsu tekoälymallia itse eikä tallenna artikkelien tekstiä —
  vain otsikon ja sen tiivisteen.

### Korjattu

- Kirjautuminen ja palvelinyhteys erotettiin toisistaan virheilmoituksissa:
  aiemmin toimimaton palvelinyhteys näytti epäonnistuneelta kirjautumiselta.
- Jakamisen salliminen paljasti kirjautumispainikkeet myös oman avaimen
  tilassa; aiemmin ne olivat piilossa, eikä jakamista voinut ottaa käyttöön.

## 0.1.2 — 2026-08-06

### Lisätty

- **Maksumuurin takaisten juttujen käsittely.** IS Extra- ja Iltalehti Plus
  -jutut tunnistetaan artikkelisivulta. Kirjautuneelle tilaajalle otsikot
  tuotetaan normaalisti; muille juttu joko häivytetään harmaaksi (💀 → 🫰) tai
  piilotetaan kokonaan. Asetus *Maksumuurin takana*.
- **Otsikon uudelleentuottaminen jutun muuttuessa.** Välimuistin kelpoisuus
  ratkaistaan artikkelin tekstin SHA-256-tiivisteellä, joten kehittyvä uutinen
  saa uuden otsikon vanhan sijaan. Sivustojen omia `ETag`-otsakkeita ei käytetä:
  Iltalehti ei lähetä niitä lainkaan, ja Ilta-Sanomien tunniste vaihtuu myös
  silloin, kun jutun sisältö ei ole muuttunut.
- **Artikkelitunnisteet välimuistin avaimena.** Sama juttu eri linkeistä
  (seurantaparametrit, `www.`, ristiinlinkitys) on nyt yksi välimuistirivi.
  Tunnisteettomille osoitteille käytetään UUIDv5-tiivistettä.
- MIT-lisenssi ja tekijänoikeusmerkintä.

## 0.1.0 — 2026-08-06

Ensimmäinen julkaisu.

### Lisätty

- Klikkiotsikoiden korvaaminen asiallisilla Ilta-Sanomien ja Iltalehden
  etusivuilla. Otsikko tuotetaan jutun **varsinaisesta sisällöstä**, ei
  alkuperäisestä otsikosta.
- Tuki kolmelle tekoälypalvelulle omalla API-avaimella: Google Gemini,
  Anthropic Claude ja OpenAI.
- Etenemismerkki otsikon perässä: pyörivä 💀 työn ajan, hillitty ✨ valmiina.
  Alkuperäinen klikkiotsikko jää näkyviin hiiren osoittimen alle.
- Tulosten välimuisti 24 tunniksi.

<!-- 0.1.1 puuttuu tarkoituksella: tagi luotiin ennen manifestin
     versionnostoa, jolloin julkaisuautomaatio hylkäsi sen. -->
