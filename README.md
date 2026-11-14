# MISSION: ORION

*Bring the NASA experience to your home.* A NASA Space Apps Challenge project: a browser-based 3D mission operations simulator. Play it with keyboard and mouse, or turn your smartphone into the mission controller.

## Run it

Requires [Node.js](https://nodejs.org) 20+.

```powershell
npm install        # first time only
npm run dev        # starts the game + the phone-controller link on port 5173
```

- **Game (PC):** open http://localhost:5173
- **Phone controller:** choose **Phone controller** in the game and scan the QR code. Or open the address printed in the terminal (`http://<PC-IP>:5173/controller/`) and type the 4-digit PIN shown on screen.

The game runs **fully offline**. All NASA data, models, fonts and sounds ship inside the project.

### Demo-day checklist

1. Connect the PC and the phone to the **same network**. A phone or laptop **mobile hotspot** is the most reliable option, because venue and guest Wi-Fi usually blocks device-to-device traffic.
2. The first time, Windows asks whether Node.js may use the network. Click **Allow** (private networks).
3. `npm run dev`, open http://localhost:5173 in Chrome or Edge, and press **F11** for full screen.
4. If the phone drops, the keyboard keeps working, and the phone reconnects on its own.

For a production build: `npm run build`, then `npm start` (serves `dist/` with the same controller link).

## NASA data used

| Data | Used for |
|---|---|
| USGS / NASA MRO **HiRISE DTM** of the Jezero crater delta front (1 m/px) | Real elevation for the Mars mission terrain |
| **HiRISE** image ESP_048842_1985 | Mars surface detail and minimap |
| NASA/JPL **Perseverance** 3D model | Player rover |
| NASA/JPL/SSI **Cassini global map of Jupiter** (PIA07782) | Jupiter |
| NASA/USGS **Galilean moon mosaics** | Io, Europa, Ganymede, Callisto |
| NASA **Tycho star map** | Real night sky, including Orion |
| NASA **Blue Marble** and **Black Marble** | Earth day side and city lights |

The full list, with credits, is on the in-game **Mission data & sources** screen (`src/data/sources.ts`). Fictional gameplay elements, such as the ARES-7 rescue, are labelled as fiction.

To regenerate the data from the original NASA/USGS sources: `node scripts/extract-jezero.mjs` and `node scripts/prepare-assets.mjs` (the latter needs the raw downloads in `data-raw/`).

## Project layout

```
server/relay.ts        local WebSocket relay (Vite plugin): pairs PC ↔ phone by PIN
src/app/App.ts         menu flow and shared systems
src/core/              engine, assets (real progress), input (phone + keyboard), link, commander, sfx
src/stages/            3D scenes (SpaceStage = menus backdrop)
src/missions/          mission registry + one folder per mission
src/ui/                screens (loading, menu, pairing, mission select)
src/data/              NASA facts and sources
controller/            phone controller page
scripts/               data extraction + QA (scripts/qa-flow.mjs)
```

**Adding a mission** (such as ISS): create `src/missions/<id>/`, add a phone layout in `controller/main.ts`, then set `enabled: true` in `src/missions/registry.ts`.
