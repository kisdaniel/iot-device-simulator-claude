# IoT eszközszimulátor

Shelly (1PM, 2PM, Add-on; Gen2, Gen3, Gen4) és Tasmota eszközök szimulációja MQTT-n keresztül, webes kezelőfelülettel. A szimulált eszközök ugyanazokat az üzeneteket küldik és fogadják, mint a valódiak, így a rájuk épülő rendszerek hardver nélkül tesztelhetők.

> **Állapot:** felvehető Shelly 1PM és 2PM (Gen2, Gen3, Gen4) opcionális Add-onnal (1–5 DS18B20), valamint Tasmota eszköz 1–8 relével, fogyasztásmérővel, 0–8 DS18B20 hőmérővel és eszközönként bekapcsolható discoveryvel. A kapcsolók MQTT-ről és a felületről is állíthatók (Shellyn időzített visszakapcsolással: `toggle_after`, ill. `on,<mp>`), a mért értékek a felületről adhatók meg. A felvett eszközökből a „Home Assistant” oldalon MQTT-konfiguráció generálható, és mellé egy `docker-compose.yml`, amely Home Assistantet és Mosquitto brokert indít, és betölti ezt a konfigurációt. A teljes konfiguráció JSON fájlba exportálható és onnan importálható, a felületről és induláskor (`CONFIG_FILE`) is. A további lépéseket a [technikai specifikáció](docs/technikai-specifikacio.md) „Megvalósítási lépések” szakasza írja le.

## Dokumentáció

- [Specifikáció](docs/specifikacio.md): mit tud a szimulátor, követelmények
- [Technikai specifikáció](docs/technikai-specifikacio.md): architektúra, adatmodell, MQTT-viselkedés, REST API, konfiguráció

## Indítás Dockerrel

```bash
docker compose up --build
```

- Felület: <http://localhost:3000>
- API-leírás (Swagger): <http://localhost:3000/api/docs>
- MQTT broker (Mosquitto): `localhost:1883`, névtelen hozzáféréssel, csak helyi fejlesztésre

## Fejlesztés

Node.js 22 vagy újabb kell.

```bash
npm install
npm run build -w shared     # a közös típusok fordítása (egyszer, ill. változás után)
npm run start:backend       # NestJS, http://localhost:3000
npm run start:frontend      # Angular, http://localhost:4200 (az /api hívásokat a 3000-es portra proxyzza)
```

| Parancs | Mit csinál |
| --- | --- |
| `npm run build` | Minden csomag fordítása |
| `npm test` | Egységtesztek (backend és frontend) |
| `npm run test:e2e` | A backend API-tesztjei memóriabeli adatbázissal és brokerrel |
| `npm run lint` | A backend statikus ellenőrzése |

## Konfiguráció

| Változó | Alap | Jelentés |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port (API és frontend) |
| `DATA_DIR` | `./data` | A `simulator.sqlite` helye |
| `MQTT_URL` | – | Brokercím, pl. `mqtt://mosquitto:1883`. Ha meg van adva, a brokerbeállítás a felületen csak olvasható |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | – | Hitelesítés |
| `MQTT_PASSWORD_FILE` | – | A jelszó fájlból (Docker secret) |
| `MQTT_CA_FILE` | – | Saját CA-tanúsítvány `mqtts` kapcsolathoz |
| `MQTT_REJECT_UNAUTHORIZED` | `true` | `false` esetén a tanúsítvány nincs ellenőrizve |
| `MQTT_CLIENT_ID` | `iot-simulator-<véletlen>` | A közös MQTT-kapcsolat kliensazonosítója |
| `CONFIG_FILE` | – | Indításkor importálandó JSON konfiguráció (pl. a felületről exportált fájl) |
| `CONFIG_IMPORT_MODE` | `seed` | `seed`: csak üres adatbázisba tölt; `merge`: létrehoz és frissít; `replace`: az eszközlista pontosan a fájl tartalma lesz |
| `MESSAGE_LOG_SIZE` | `200` | Eszközönként megőrzött MQTT-üzenetek száma |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` vagy `debug` |

**JSON konfiguráció.** A Beállítások oldalon a teljes konfiguráció JSON fájlba exportálható (választhatóan a pillanatnyi állapottal, a broker jelszava nélkül), és ugyanott importálható. Az import előbb előnézetet mutat (mi jön létre, mi frissül, mi törlődik), és csak megerősítés után ír; hibás fájlnál semmi nem változik. Ugyanez a fájl `CONFIG_FILE`-ként indításkor is betölthető; mintának a [config/devices.json](config/devices.json) szolgál, a `docker-compose.yml` kikommentelt sorai mutatják a csatolását. A formátumot a technikai specifikáció „JSON konfiguráció: import és export” szakasza írja le.

## Felépítés

```text
shared/     közös TypeScript típusok
backend/    NestJS: REST API, MQTT-szimuláció, SQLite (TypeORM)
frontend/   Angular + Bootstrap kezelőfelület
docker/     a Mosquitto broker konfigurációja
config/     minta eszközlista a CONFIG_FILE-hoz
docs/       specifikációk
```

## Commitok

A tároló a [Conventional Commits](https://www.conventionalcommits.org/) formátumot követi; a `commitlint` helyben (husky) és a CI-ban is ellenőrzi. A megengedett típusokat és hatóköröket a technikai specifikáció „Verziókezelés és commit-szabályok” szakasza sorolja fel.
