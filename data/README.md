# data/

Placeholder for T1.

In T2 this directory will contain the Europe-16 scenario package:
- Natural Earth Admin-0 1:50m GeoJSON (local copy, no network at runtime)
- `scenario.json` with 16 countries, 60–120 generated regions inside country polygons
- adjacency lists (common-border only) and sea-crossing list
- `leaders.json` (1 active + 2–3 pool per country, with source+since)
- `parties.json` (2+ parties per country with foreignStance)
- capitals and `electionMonth`/`electionDay` per country

Versioning and attribution will be documented in `data/attribution.md` and this README.
T1 only provides a placeholder so `npm run dev` and imports resolve.
