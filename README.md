# IoT eszközszimulátor

Shelly (1PM, 2PM, Add-on; Gen2, Gen3, Gen4) és Tasmota eszközök szimulációja MQTT-n keresztül, webes kezelőfelülettel. A szimulált eszközök ugyanazokat az üzeneteket küldik és fogadják, mint a valódiak, így a rájuk épülő rendszerek hardver nélkül tesztelhetők.

> **Állapot:** Shelly 1PM és 2PM (Gen2, Gen3, Gen4) eszköz felvehető, és MQTT-ről (RPC, `command` topicok) vagy a felületről kapcsolható. A fogyasztásmérés, az Add-on hőmérői és a Tasmota a következő lépésekben érkeznek; a sorrendet a [technikai specifikáció](docs/technikai-specifikacio.md) „Megvalósítási lépések” szakasza írja le.

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
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` vagy `debug` |

A `MQTT_CLIENT_ID`, `CONFIG_FILE`, `CONFIG_IMPORT_MODE` és `MESSAGE_LOG_SIZE` változót az alkalmazás már beolvassa és ellenőrzi, de csak a későbbi lépésekben kap szerepet.

## Felépítés

```text
shared/     közös TypeScript típusok
backend/    NestJS: REST API, SQLite (TypeORM), később az MQTT-szimuláció
frontend/   Angular + Bootstrap kezelőfelület
docker/     a Mosquitto broker konfigurációja
docs/       specifikációk
```

## Commitok

A tároló a [Conventional Commits](https://www.conventionalcommits.org/) formátumot követi; a `commitlint` helyben (husky) és a CI-ban is ellenőrzi. A megengedett típusokat és hatóköröket a technikai specifikáció „Verziókezelés és commit-szabályok” szakasza sorolja fel.
