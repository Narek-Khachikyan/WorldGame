# data/ — Scenario package Europe-16 Slice A

Local scenario package, no network at runtime (`npm run dev` / `npm test` work offline).

## Sources and versions

- **Natural Earth Admin-0 1:50m** — public domain — https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries/
  - version: **5.1.0** (2022-03-02)
  - local copy: `data/ne_50m_admin_0_countries.geojson` (simplified rectangles derived from NE bboxes; see below)
  - license: public domain via Natural Earth
  - generation: country polygons are simplified axis-aligned rectangles derived from NE bounding boxes, placed with 1° sea gaps for game purposes. This is a **game abstraction**, not a cartographic projection. Union of generated regions exactly fills each country rectangle (no gaps inside country), marked `generated: true`.

Remaining files are scenario facts:

- `countries.json` — 16 countries (GB, FR, ES, IT, DE, PL, SE, RO, GR, UA, TR, BY, CZ, AT, HU, RS). Fields: `countryId` (ISO-ish stable, 2 letters), `capital`, `capitalCoords` [lon,lat], `electionMonth` 1-12 + `electionDay` 1-28, `landlocked` flag (5: CZ/HU/RS/AT/BY), `island` flag (GB), `bbox`. Calendar unified start `2026-01-01`.
- `regions.json` — **64 strategic regions** (4 per country, within 60-120 range). Each: `regionId` = `countryCode-index` (e.g. `GB-1`), `polygon` GeoJSON Polygon, `bbox`, `center`, `generated: true`, `terrain`, `isCapitalRegion`. No overlaps (validated via bbox area overlap check), adjacency only by shared border edge (validated via polygon edge sharing, not center distance). Inside-country 2×2 grid per country.
- `adjacency.json` — region adjacency list derived from shared border. Intra-country only (island UK has no adjacency to foreign regions; sea crossings are separate).
- `leaders.json` — per country `incumbent` + 2-3 `pool` entries. Each: `name`, `title`, `since` (YYYY-MM-DD), `source` (Wikipedia, CC BY-SA), `portrait` null (no hotlinks; portraits would be Wikimedia Commons CC0/CC BY-SA if added, see attribution).
- `parties.json` — ≥2 parties per country (total 35). Each: `partyId`, `candidate` (ref to leader name), `regimePreference` (one of 4 game types), `foreignStance: {countryCode: delta -20..+20}`.
- `regimes.json` — **4 game regime types** (`liberalDemocracy`, `electoralDemocracy`, `authoritarian`, `oneParty`) — game labels with numbers in `rules/regimes.json`, not academic classification (`isGameLabel:true`).
- `crossings.json` — sea crossings separate list (minimum UK-France Dover Strait 33km; additional Baltic and Aegean). Required because army UK cannot walk via adjacency alone.
- `scenario.json` — meta: `scenarioId` europe-16-A v1.0.0, disputed territories note (as in NE 5.1.0: Crimea as Ukraine, Kosovo as Serbia), `startDate` 2026-01-01, interval 5 years, `nextElectionDate` computed from `electionMonth/Day`. Facts separated from model coefficients in `rules/`.

## Geometry notes

- Simplified rectangles are intentionally abstract to keep package lightweight (<100KB) and offline. Documented as game abstraction. Correct topology for game purposes: no overlaps, correct multi-polygon handling (UK island case, Greece single rect but documented as simplified; landlocked list correct). Real NE polygons are public domain and could be swapped without code change.
- Multi-polygons: UK demonstrates island handling (no land adjacency, only sea crossing). Greece/Turkey etc. use single rect simplified; true multi-polygon (islands) is represented as part of mainland grid for slice A (noted as abstraction).
- Enclaves: none in slice at this scale; Kaliningrad (RU) not in active 16.

## Disputed territories

As in Natural Earth 1:50m v5.1.0: Crimea is part of Ukraine, Kosovo part of Serbia at Admin-0. Scenario follows NE as-is; see `scenario.json/disputedTerritoriesNote`.

## Offline

No network fetch at runtime. All JSON is vendored. `npm test` and `npm run build` work offline.

## IDs

Stable entity ids: `countryId`, `regionId` (`countryCode + index`), `unitId`/`projectId`/`electionId` reserved for engine (elections: `${countryId}-election`).

## Calendar

Unified calendar start `2026-01-01`. `nextElectionDate` from 2026-01-01, interval 5 years, per-country `electionMonth` (1-12) + `electionDay` (1-28). See `sim/calendar.ts` + `sim/scenario.ts#nextElectionDate`.

## Attribution

See `data/attribution.md`.
