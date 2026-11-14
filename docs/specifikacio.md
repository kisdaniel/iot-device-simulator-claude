# IoT szimulátor – specifikáció

Állapot: 2026-11-14

## Cél és hatókör

A szimulátor valódi hardver nélkül állít elő Shelly és Tasmota eszközöket egy MQTT brokeren: a beállított virtuális eszközök ugyanazokat az üzeneteket küldik és fogadják, mint a fizikai eszközök. A cél, hogy az eszközökre épülő rendszerek (okosotthon-vezérlő, saját backend, integrációs tesztek) hardver nélkül fejleszthetők és tesztelhetők legyenek.

A felhasználó egy webes felületen veszi fel az eszközöket, kapcsolja a reléket, és kézzel adja meg a mért értékeket (fogyasztás, hőmérséklet).

**A hatókör része**

- Csatlakozás egy meglévő MQTT brokerhez egyetlen közös kapcsolaton (a szimulátor nem tartalmaz brokert).
- Shelly 1PM és Shelly 2PM szimulációja Gen2 (Plus), Gen3 és Gen4 változatban, opcionális Add-onnal: kapcsoló, fogyasztásmérés, az Add-onon hőmérés.
- Tasmota eszköz szimulációja: kapcsoló, fogyasztásmérés, DS18B20 hőmérők, eszközönként bekapcsolható Tasmota discovery.
- Webes kezelőfelület az eszközök felvételéhez és vezérléséhez.

**Nem része a hatókörnek**

- Shelly Gen1 eszközök (eltérő MQTT-protokoll).
- Az eszközök HTTP API-ja, webes felülete, WebSocket- és Bluetooth-csatornája, a Gen4 Matter- és Zigbee-felülete.
- A 2PM redőny (cover) üzemmódja, bemenetek (input), szkriptek, ütemezések, OTA-frissítés.
- Az Add-on hőmérőn kívüli perifériái (páratartalom, analóg és digitális bemenet).
- Tasmota szabályok (rules), időzítők és a kapcsolón, fogyasztásmérőn, DS18B20 hőmérőn kívüli szenzorok.
- Felhasználókezelés és jogosultságok: az eszköz egyfelhasználós fejlesztői segédprogram.

## Támogatott eszközök

A Shelly 1PM és 2PM három generációja (Gen2, Gen3, Gen4) és a Tasmota vehető fel; az Add-on nem önálló eszköz, hanem egy Shelly gazdaeszköz bővítése. A három Shelly-generáció MQTT-felülete azonos (Gen2+ API), csak az eszközazonosító és a modellkód tér el.

| Típus | Generáció | Kapcsoló | Fogyasztásmérés | Hőmérő | Megjegyzés |
| --- | --- | --- | --- | --- | --- |
| Shelly 1PM | Gen2 (Plus), Gen3, Gen4 | 1 db (`switch:0`) | kapcsolónként | Add-onnal | Azonosító: `shellyplus1pm-<mac>`, `shelly1pmg3-<mac>`, `shelly1pmg4-<mac>` |
| Shelly 2PM | Gen2 (Plus), Gen3, Gen4 | 2 db (`switch:0`, `switch:1`) | kapcsolónként külön | Add-onnal | Azonosító: `shellyplus2pm-<mac>`, `shelly2pmg3-<mac>`, `shelly2pmg4-<mac>`; csak kapcsoló (switch) profil |
| Shelly Add-on | a gazdaeszközé | – | – | 1–5 db DS18B20 (`temperature:100`–`104`) | Bármelyik fenti Shelly eszközön bekapcsolható opció |
| Tasmota | – | 1–8 db (`POWER`, ill. `POWER1`…`POWERn`) | eszközszinten egy `ENERGY` blokk | 0–8 db DS18B20 | A topic szabadon megadható; a discovery eszközönként bekapcsolható |

Az Add-on hőmérőinek számozása a valós eszközt követi: [legfeljebb 5 DS18B20 köthető rá](https://www.shelly.com/de/products/shelly-plus-add-on), az első szonda a 100-as komponensazonosítót kapja, a következő a 101-est ([TapHome leírás](https://taphome.com/en/compatibility/shelly-sensor-add-on/)).

## Funkcionális követelmények

A követelmények azonosítója a technikai specifikációban és a tesztekben hivatkozási alap. Prioritás: K = kötelező az első verzióban, O = opcionális.

### MQTT kapcsolat

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-01 | A broker címe, portja, felhasználóneve, jelszava és a TLS használata környezeti változókból vagy a felületen állítható be, és újraindítás után megmarad. Ha környezeti változó adja meg, a felületen csak olvasható. | K |
| F-02 | A szimulátor egyetlen közös MQTT-kapcsolaton szolgálja ki az összes eszközt; a vezérlő-, állapot- és telemetriatopicokon a valós eszköznek megfelelő üzenetek közlekednek. | K |
| F-03 | Az eszköz indításkor az elérhetőségi topicján jelzi, hogy elérhető; lekapcsoláskor, törléskor és a szimulátor leállításakor a szimulátor maga teszi közzé a nem elérhető üzenetet, a valós eszköz végakarat-üzenetével (LWT) azonos tartalommal. | K |
| F-04 | A kapcsolat megszakadása után a szimulátor automatikusan újracsatlakozik, és minden aktív eszköz újra közzéteszi az állapotát. | K |
| F-05 | A felület mutatja a brokerkapcsolat állapotát és azt, hogy az egyes eszközök aktívak-e. | K |

### Eszközkezelés

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-10 | Új eszköz vehető fel: típus, Shelly esetén generáció (Gen2, Gen3, Gen4), megjelenített név, eszközazonosító (MAC-ből generálható), topic-előtag, ill. Tasmota topic. | K |
| F-11 | Shelly eszközön bekapcsolható az Add-on, és megadható a hőmérők száma (1–5). | K |
| F-12 | Tasmota eszközön megadható a relék száma, a DS18B20 hőmérők száma (0–8), és hogy van-e fogyasztásmérő. | K |
| F-13 | Az eszköz szerkeszthető és törölhető; törléskor az eszköz nem elérhetőként jelenti magát. | K |
| F-14 | Az eszköz a felületről le- és visszakapcsolható (kiesés szimulációja): lekapcsolva nem elérhetőként jelenti magát, és nem küld, nem fogad üzenetet. | K |
| F-15 | Az eszközök és utolsó állapotuk helyi SQLite adatbázisban tárolódnak, és újraindítás után megmaradnak. | K |
| F-16 | Meglévő eszköz másolható (új azonosítóval), hogy sok eszköz gyorsan felvehető legyen. | O |
| F-17 | Tasmota eszközön eszközönként bekapcsolható a Tasmota discovery: az eszköz megőrzött felfedezési üzenetet tesz közzé, amelyből a Home Assistant Tasmota integrációja magától felveszi; kikapcsoláskor és törléskor az üzenet törlődik. | K |

### Kapcsoló

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-20 | A kapcsoló a felületről ki-be kapcsolható; az állapotváltásról az eszköz azonnal üzenetet küld, mintha a fizikai gombot nyomták volna meg. | K |
| F-21 | A kapcsoló MQTT-n érkező parancsra is kapcsol (be, ki, átváltás), és a valós eszköznek megfelelő választ és állapotüzenetet küldi. | K |
| F-22 | Az állapot MQTT-n lekérdezhető (Shelly: RPC és `status_update`; Tasmota: üres `POWER` parancs). | K |
| F-23 | Az MQTT-n érkezett kapcsolás a felületen frissítés nélkül, 1 másodpercen belül megjelenik. | K |
| F-24 | Shelly időzített visszakapcsolás (`toggle_after`, ill. `on,<mp>`) támogatása. | O |

### Fogyasztásmérő

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-30 | A felhasználó megadja a terhelés teljesítményét (W) és a feszültséget (V); az áramerősség ezekből számolódik, de kézzel felülírható. Teljesítménytényező és frekvencia is megadható. | K |
| F-31 | Kikapcsolt kapcsolónál a jelentett teljesítmény és áramerősség 0, a beállított terhelés megmarad a következő bekapcsolásig. | K |
| F-32 | Az energiaszámláló a jelentett teljesítményből időarányosan növekszik (Shelly: Wh, Tasmota: kWh). | K |
| F-33 | Az energiaszámláló kézzel beállítható és nullázható. | K |
| F-34 | A mért értékek változáskor azonnal, ezen felül az eszközre jellemző időközönként is elküldésre kerülnek (Shelly: percenként, Tasmota: `TelePeriod`). | K |

### Hőmérő (Shelly Add-on és Tasmota DS18B20)

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-40 | Minden hőmérő értéke °C-ban megadható (−55 … +125 °C, 0,1 °C lépésköz); a °F érték számolt. | K |
| F-41 | Értékváltozáskor a Shelly eszköz állapotüzenetet küld az adott `temperature:<id>` komponensről, a Tasmota eszköz `SENSOR` telemetriát a `DS18B20` blokkal. | K |
| F-42 | A hőmérő értéke MQTT-n lekérdezhető (Shelly: `Temperature.GetStatus`; Tasmota: `STATUS 10`). | K |
| F-43 | Szenzorhiba szimulálható: az érték `null`, a hiba `read`. | O |

### Üzenetnapló

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-50 | Eszközönként látható az utolsó 200 küldött és fogadott MQTT-üzenet (idő, irány, topic, tartalom). | O |

### Konfiguráció, import és export

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-60 | Az MQTT-kapcsolat és az alkalmazás alapbeállításai (port, adatkönyvtár, naplószint) környezeti változókból megadhatók. | K |
| F-61 | Indításkor az eszközlista külső JSON fájlból importálható; a fájl útvonala és az import módja környezeti változó. | K |
| F-62 | Az import három módot ismer: csak üres adatbázisba tölt, összefésül a meglévő eszközökkel, vagy teljesen lecseréli az eszközlistát. | K |
| F-63 | A teljes konfiguráció a felületről JSON fájlba exportálható, választhatóan a pillanatnyi állapottal együtt; az exportált fájl változtatás nélkül visszatölthető. A broker jelszava nem kerül bele. | K |
| F-64 | JSON fájl a felületről is importálható; a felület az írás előtt megmutatja, hány eszköz jön létre, frissül és törlődik. | K |
| F-65 | Hibás fájl esetén semmi nem változik, és a hibaüzenet megnevezi a hibás eszközt és mezőt. | K |

### Home Assistant konfiguráció

| Az. | Követelmény | Prio |
| --- | --- | --- |
| F-70 | A felület a felvett eszközökből Home Assistant MQTT-konfigurációt generál (`configuration.yaml`-ba másolható `mqtt:` blokk): kapcsolónként egy `switch`, mért értékenként és hőmérőnként egy `sensor` entitás, eszközönként csoportosítva, elérhetőséggel. | K |
| F-71 | A konfigurációba kerülő eszközök kiválaszthatók; az eredmény előnézetben látszik, vágólapra másolható és fájlként letölthető. | K |
| F-72 | A discoveryvel felvett Tasmota eszközök alapból kimaradnak, mert a Home Assistant már felismeri őket; kérésre bekerülnek. A generátor figyelmeztet, ha egy eszköz beállítása miatt az entitás nem kap állapotot (például kikapcsolt Shelly-értesítések). | K |

## Felhasználói felület

A felület egyoldalas Angular alkalmazás Bootstrap stílussal, négy képernyővel. A nyelve magyar.

| Képernyő | Tartalom | Műveletek |
| --- | --- | --- |
| Eszközlista (kezdőlap) | Eszközönként egy kártya: név, típus, azonosító, kapcsolati állapot, kapcsolók, aktuális teljesítmény, hőmérsékletek. Fejlécben a broker állapota. | Kapcsoló átbillentése közvetlenül a kártyán; új eszköz; szűrés típusra és névre. |
| Eszköz részletei | Kapcsolónként egy blokk: állapot, terhelés (W), feszültség (V), áramerősség (A), energiaszámláló. Hőmérőnként egy beviteli mező és csúszka. Az eszköz MQTT topicjai. Üzenetnapló. | Kapcsolás; mért értékek megadása; számláló nullázása; lekapcsolás és visszakapcsolás; szerkesztés; másolás; törlés (megerősítéssel). |
| Home Assistant | A felvett eszközök listája jelölőnégyzetekkel, a generált YAML előnézete, darabszámok és figyelmeztetések. | Eszközök kiválasztása; discoveryvel felvett Tasmota eszközök bevonása; másolás; letöltés. |
| Beállítások | Broker kapcsolati adatai, kapcsolati állapot és az utolsó hibaüzenet. | Mentés; kapcsolat tesztelése; konfiguráció exportálása és importálása JSON fájlból, előnézettel. |

Az új eszköz űrlapja a típus kiválasztása után csak az adott típusra érvényes mezőket mutatja, és előnézetben kiírja a létrejövő topicokat. A mért értékek beírása Enterre vagy a mező elhagyásakor lép érvénybe; érvénytelen értéknél a mező hibát jelez, és nem megy ki üzenet.

## Nem funkcionális követelmények

| Az. | Követelmény |
| --- | --- |
| N-01 | Hűség: a topicok és az üzenetek szerkezete egyezik a valós eszközökével, így a vezérlő oldalon nem kell külön beállítás a szimulált eszközhöz. |
| N-02 | Kapacitás: legalább 100 egyidejű szimulált eszköz egy fejlesztői gépen. |
| N-03 | Válaszidő: a felületi művelet és az MQTT-üzenet kiküldése között legfeljebb 200 ms telik el helyi brokerrel. |
| N-04 | Telepítés: saját Docker-kép és Docker Compose fájl előre beállított MQTT brokerrel; egy paranccsal indul, és a backend szolgálja ki a frontendet is. |
| N-05 | Bővíthetőség: új eszköztípus a meglévő kód módosítása nélkül, új eszközprofil hozzáadásával vehető fel. |
| N-06 | Biztonság: a felület hitelesítés nélküli, ezért csak megbízható hálózaton futtatható; a broker jelszavát az API nem adja vissza. |
| N-07 | Böngészők: az aktuális Chrome, Firefox és Edge; a felület tableten is használható. |

## Feltételezések és nyitott kérdések

Az alábbi döntéseket feltételezésként hoztam meg; bármelyik módosítható, mielőtt a fejlesztés elindul.

- [ ] **Shelly MQTT-beállítások.** Mindhárom csatorna alapból bekapcsolt (RPC-értesítések, általános állapotüzenetek, MQTT-vezérlés), eszközönként kikapcsolhatók. A valós eszközön az általános állapotüzenet alapból kikapcsolt.
- [ ] **Egy broker.** Minden eszköz ugyanazon a közös brokerkapcsolaton közlekedik. Kell-e eszközönként eltérő broker?
- [ ] **Automatikus értékgenerálás.** Az értékeket csak kézzel lehet megadni. Kell-e később időbeli forgatókönyv (pl. ingadozó fogyasztás, lassan változó hőmérséklet)?
- [ ] **Gen3 és Gen4 azonosítók.** A 2PM Gen3 és az 1PM Gen4 azonosítója és modellkódja a többi eszköz névmintájából következtetett; valós eszközzel vagy a gyártói adatlappal ellenőrizendő.
