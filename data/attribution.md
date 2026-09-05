# Attribution

## Natural Earth

- **Natural Earth Admin-0 Countries 1:50m** — public domain
  - version: **5.1.0**
  - source: https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries/
  - local copy: `data/ne_50m_admin_0_countries.geojson` — simplified rectangles derived from NE Admin-0 bounding boxes (game abstraction, see `data/README.md`). Original NE data is public domain; derived rectangles are also public domain.
  - license: public domain (Natural Earth “no restrictions”)

## Leaders and portraits

- All leader names/titles/since/sources are factual, sourced from Wikipedia (CC BY-SA 4.0) with per-entry `source` field in `data/leaders.json` (e.g. “Wikipedia — Keir Starmer, accessed 2026-09-05”). No scraped photos.
- Portraits (T7): **not vendored** in slice A (field `portrait: null` for all 16). No non-free portraits are used. UI renders initials avatar via `ui/LeaderAvatar.tsx` (no external images, no hotlinks). Where portraits are added in future, they will be only freely licensed images (Wikimedia Commons, CC BY-SA / CC0) stored locally in `data/portraits/` with per-image source and license in `leaders.json` + this file. No hotlinking. Verified: no portrait files are bundled, `data/leaders.json` all `portrait:null`, `ui/LeaderAvatar.tsx` uses initials only.
- Example per-entry source: `Wikipedia — Emmanuel Macron, accessed 2026-09-05`.
- Compliance T7: `find data -type f -name '*.jpg' -o -name '*.png' | xargs` yields no portraits; `grep portrait data/leaders.json` shows only null. No network at runtime.

## Regimes

- 4 game regime types (`liberalDemocracy`, `electoralDemocracy`, `authoritarian`, `oneParty`) are **game labels** with numeric coefficients in `rules/regimes.json`, not academic classifications. Flagged `isGameLabel:true` in `data/regimes.json`. Coefficients are model balances, not statistics.

## Scenario generation

- Strategic regions: procedural rectangles clipped inside country bboxes, marked `generated:true`, no overlaps, correct geometry for game purposes (UK island, 5 landlocked: CZ/HU/RS/AT/BY). See `data/README.md` and `data/adjacency.json` (adjacency only by shared border, not center distance). Sea crossings in `data/crossings.json` (Dover Strait 33km UK-FR, Baltic, Aegean).

## No network at runtime

All files are local. No fetch, no hotlinks.
