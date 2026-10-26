# Muutosloki

Kaikki huomionarvoiset muutokset kirjataan tähän tiedostoon. Versionumerot ovat
samat kuin `extension/manifest.json`-tiedostossa, ja jokainen julkaisu vastaa
`v<versio>`-tagia.

## 0.4.0 — julkaisematta

### Lisätty

- **Kirjaudu OpenRouteriin**: API-avainta ei tarvitse enää kopioida itse.
  Ponnahdusikkunan painike avaa OpenRouterin kirjautumisen, ja laajennus saa
  avaimen omalle OpenRouter-tilillesi. Tämä on nyt oletuspalvelu; oletusmalli on
  Anthropicin Claude Haiku 5.5. Oma Gemini-, Claude- tai OpenAI-avain käy
  edelleen.
- **Ollama (oma kone)**: otsikot voi tuottaa omalla koneella pyörivällä mallilla
  (oletuksena Gemma 4). Ei tiliä, ei avainta, ei maksua, eikä juttujen teksti
  lähde koneelta. Ohjeet ponnahdusikkunassa.
- **Iltasaatana-tila**: asetuksesta "Otsikon näyttötapa" voi valita tilan, joka
  jättää klikkiotsikon ennalleen ja lisää sen perään ", saatana!" ("Mitä
  tapahtui, saatana?"). Juttuja ei haeta eikä tekoälyä käytetä, joten
  API-avainta ei tarvita.

### Muutettu

- Otsikot ovat lyhyempiä: enintään noin 70 merkkiä, vain pääasia, eikä enää
  turhia viikonpäiviä tai kellonaikoja ("sunnuntain vastaisena yönä").
  Uudemmat mallit (kuten Gemini 3.5 Flash-Lite) tuottivat aiemmin selvästi
  pidempiä otsikoita. Vanhat välimuistissa olevat otsikot tuotetaan uudelleen.

### Poistettu

- Yhteinen otsikkotietokanta ja Google-kirjautuminen on poistettu. Otsikot
  tuotetaan nyt aina omassa selaimessasi omalla API-avaimellasi, eikä mikään
  palvelin käsittele juttuja. Syy: Sanoma ja Alma Media kieltävät sisältönsä
  käytön tekoälyssä, joten laajennus toimii vain lukijan omana apuvälineenä.
  Jos käytit yhteistä tietokantaa, kirjaudu OpenRouteriin ponnahdusikkunassa.
- Otsikoiden jakaminen muille on poistettu samasta syystä.

## 0.3.2 — 2026-10-25

### Korjattu

- Otsikon alla oleva pienempi rivi skaalautuu nyt otsikon koon mukaan ja on
  luettavan kokoinen myös sivupalkin "Luetuimmat"-listoissa. Se näytetään
  sivuston leipätekstin fontilla eikä enää lihavoituna.
- Iltalehdessä pienempi rivi oli "Luetuimmat"-listassa otsikon vieressä eikä
  sen alla, ja 💀/✨-merkki putosi omalle rivilleen otsikon perästä.
- Iltalehdessä pienellä näytetty klikkiotsikko sisälsi myös jutun osaston ja
  kellonajan.

## 0.3.1 — 2026-10-25

### Muutettu

- Otsikko korvataan edelleen, mutta alkuperäinen klikkiotsikko näkyy nyt
  pienemmällä sen alla. Asetuksesta "Otsikon näyttötapa" voi valita myös
  pelkän korvatun otsikon tai klikkiotsikon, jonka alla asiallinen otsikko
  näkyy pienemmällä. Aiempi "Pelkkä spoileri" -vaihtoehto poistettu, koska se
  näytti samalta kuin pelkkä korvattu otsikko.
- Mainokset ja kaupalliset yhteistyöt piilotetaan nyt oletuksena. Asetuksesta
  "Piilota mainokset" ne saa takaisin näkyviin.

## 0.3.0 — 2026-10-25

### Muutettu

- Maksumuurin takaisten juttujen oletuskäsittely vaihdettu "Häivytä" →
  "Piilota kokonaan": IS Extra- ja Iltalehti Plus -jutut piilotetaan nyt
  oletuksena kokonaan. Harmaannuksen saa takaisin asetuksista.

### Lisätty

- Uusi asetus "Otsikon näyttötapa": klikkiotsikon voi edelleen korvata
  (oletus), tai sen voi jättää näkyviin ja näyttää asiallisen spoilerin
  pienemmällä sen alla, tai näyttää pelkän spoilerin.
- Uusi asetus "Piilota mainokset" (oletuksena pois): piilottaa etusivulta
  IS:n tuoteartikkelit ja IL:n "Kaupallinen yhteistyö" -jutut.
- Uusi asetus "Häivytä myös ohitetut" (oletuksena pois): harmaannuttaa myös
  jutut, joiden otsikkoa ei voitu korvata, jotta näet mitä laajennus ei saanut
  tehtyä.

### Korjattu

- Gemini-tilan oletusmalli vaihdettu `gemini-2.5-flash-lite` → `gemini-3.5-flash`,
  koska vanha malli palautti uusilla API-avaimilla pelkkää 404-virhettä eikä
  otsikoita siis syntynyt lainkaan.
- Gemini-kutsun tokenbudjetti nostettu 200:sta 1200:aan, koska uudempi malli
  kuluttaa osan samasta budjetista sisäiseen ajatteluun ennen vastausta —
  ilman reilua budjettia otsikko saattoi katketa kesken sanan ("Kansaned",
  "keskiviikk"). (Kokeiltiin myös pakottaa `thinkingLevel: 'minimal'`, mutta se
  tuotti puutteellisia otsikoita siitäkin huolimatta, joten ajattelutaso jätetty
  mallin oletukseen.) Gemini-vastaus, joka katkeaa `finishReason:
  MAX_TOKENS`:iin, hylätään ja yritetään uudelleen sen sijaan että typistetty
  otsikko päätyisi sivulle.
- Gemini-vastauksen `parts`-taulukosta suodatetaan pois `thought: true`
  -merkityt ajatteluosat ennen kuin ne liitetään otsikkotekstiksi.

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
