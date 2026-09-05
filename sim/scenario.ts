/**
 * Scenario loader + validator for Slice A (Europe-16).
 * Pure TS, no React. Offline only — imports local JSON.
 *Facts (borders, capitals, leaders, parties, election dates) are in data/ ; model coefficients in rules/.
 */
import { START_DATE } from "./calendar.js";
import countriesRaw from "../data/countries.json";
import regionsRaw from "../data/regions.json";
import leadersRaw from "../data/leaders.json";
import partiesRaw from "../data/parties.json";
import regimesRaw from "../data/regimes.json";
import crossingsRaw from "../data/crossings.json";
import adjacencyRaw from "../data/adjacency.json";
import scenarioRaw from "../data/scenario.json";
import geojsonRaw from "../data/ne_50m_admin_0_countries.json";
import regimeCoeffsRaw from "../rules/regimes.json";

// — types

export type CountryCode = string;
export interface Country {
  countryId: string;
  countryCode: string;
  isoA2: string;
  isoA3: string;
  nameEn: string;
  nameRu: string;
  capital: string;
  capitalCoords: [number, number];
  electionMonth: number;
  electionDay: number;
  landlocked: boolean;
  island: boolean;
  bbox: [number, number, number, number];
}

export interface Region {
  regionId: string;
  countryId: string;
  countryCode: string;
  name: string;
  nameRu: string;
  bbox: [number, number, number, number];
  polygon: { type: "Polygon"; coordinates: number[][][] };
  center: [number, number];
  generated: boolean;
  terrain: string;
  isCapitalRegion: boolean;
}

export interface LeaderEntry {
  name: string;
  title: string;
  since: string;
  source: string;
  portrait?: string | null;
}
export interface LeadersForCountry {
  countryId: string;
  incumbent: LeaderEntry;
  pool: LeaderEntry[];
}

export interface Party {
  partyId: string;
  countryId: string;
  name: string;
  nameRu: string;
  candidate: string;
  regimePreference: string;
  foreignStance: Record<string, number>;
}

export interface RegimeFact {
  regimeId: string;
  nameEn: string;
  nameRu: string;
  description: string;
  descriptionRu: string;
  isGameLabel: boolean;
}

export interface Crossing {
  crossingId: string;
  fromRegionId: string;
  toRegionId: string;
  fromCountryId: string;
  toCountryId: string;
  type: string;
  name: string;
  nameRu: string;
  distanceKm: number;
  requiredFor: string;
}

export interface Scenario {
  scenarioId: string;
  name: string;
  nameRu: string;
  version: string;
  description: string;
  descriptionRu: string;
  disputedTerritoriesNote: string;
  startDate: string;
  electionIntervalYears: number;
  totalCountries: number;
  totalRegions: number;
  generated: boolean;
  countries: Country[];
  regions: Region[];
  leaders: LeadersForCountry[];
  parties: Party[];
  regimes: RegimeFact[];
  crossings: Crossing[];
  adjacency: Record<string, string[]>;
  geojson: unknown;
  regimeCoefficients: unknown;
}

// — helpers

const REGIME_IDS = new Set(["liberalDemocracy", "electoralDemocracy", "authoritarian", "oneParty"]);
export const LANDLOCKED_CODES = ["CZ", "AT", "HU", "RS", "BY"] as const;
export const ISLAND_CODE = "GB" as const;

function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function parseISODate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

export function nextElectionDate(
  electionMonth: number,
  electionDay: number,
  fromDateStr: string,
  intervalYears = 5
): string {
  if (electionMonth < 1 || electionMonth > 12) throw new Error(`electionMonth out of range 1-12: ${electionMonth}`);
  if (electionDay < 1 || electionDay > 28) throw new Error(`electionDay out of range 1-28: ${electionDay}`);
  const from = parseISODate(fromDateStr);
  const fromYear = from.getUTCFullYear();
  // candidate in fromYear
  let candidateYear = fromYear;
  // if from date is after election date in candidateYear, move to next interval
  // But interval is 5 years from start, not every year. Elections every 5 years, not annually.
  // So we need to find the next election year that is startYear + k*interval.
  const startYear = 2026;
  // Find k such that election date >= fromDate
  // Compute k = ceil((candidateYear - startYear)/interval) maybe?
  // Actually election in year = startYear + n*interval, but month/day is fixed per country.
  // Need to find smallest n >=0 such that date(startYear+n*interval, month, day) >= fromDate
  let n = 0;
  if (fromYear < startYear) n = 0;
  else {
    n = Math.ceil((fromYear - startYear) / intervalYears);
    // adjust: if election date in that year is before fromDate, need next interval
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const year = startYear + n * intervalYears;
    const cand = `${String(year).padStart(4, "0")}-${String(electionMonth).padStart(2, "0")}-${String(electionDay).padStart(2, "0")}`;
    if (cand >= fromDateStr) return cand;
    n++;
  }
  throw new Error(`could not compute nextElectionDate for ${electionMonth}/${electionDay} from ${fromDateStr}`);
}

export function getNextElectionDateForCountry(country: Country, fromDateStr: string): string {
  return nextElectionDate(country.electionMonth, country.electionDay, fromDateStr, 5);
}

// geometry helpers (bbox overlap area > eps)
function bboxesOverlapArea(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const xOverlap = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  const yOverlap = Math.min(ay2, by2) - Math.max(ay1, by1);
  return xOverlap > 1e-9 && yOverlap > 1e-9;
}

function polygonsShareEdge(polyA: number[][][], polyB: number[][][]): boolean {
  // For our rectangles, check if they share a full edge segment (not just point)
  // Extract bbox of each polygon ring
  const ringA = polyA[0];
  const ringB = polyB[0];
  // Build set of edges for A: segments
  const edgesA: Array<[[number, number], [number, number]]> = [];
  for (let i = 0; i < ringA.length - 1; i++) edgesA.push([ringA[i] as [number, number], ringA[i + 1] as [number, number]]);
  const edgesB: Array<[[number, number], [number, number]]> = [];
  for (let i = 0; i < ringB.length - 1; i++) edgesB.push([ringB[i] as [number, number], ringB[i + 1] as [number, number]]);
  for (const [a1, a2] of edgesA) {
    for (const [b1, b2] of edgesB) {
      // check collinear and overlapping with length > eps
      // Axis-aligned rectangles: edges are either horizontal or vertical
      // Simplify: check if segments are collinear and overlapping
      const isAHoriz = Math.abs(a1[1] - a2[1]) < 1e-9;
      const isBHoriz = Math.abs(b1[1] - b2[1]) < 1e-9;
      if (isAHoriz !== isBHoriz) continue;
      if (isAHoriz) {
        // horizontal: y equal and x intervals overlap with len>eps
        if (Math.abs(a1[1] - b1[1]) > 1e-9) continue;
        const aMinX = Math.min(a1[0], a2[0]), aMaxX = Math.max(a1[0], a2[0]);
        const bMinX = Math.min(b1[0], b2[0]), bMaxX = Math.max(b1[0], b2[0]);
        const overlap = Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX);
        if (overlap > 1e-9) return true;
      } else {
        // vertical
        if (Math.abs(a1[0] - b1[0]) > 1e-9) continue;
        const aMinY = Math.min(a1[1], a2[1]), aMaxY = Math.max(a1[1], a2[1]);
        const bMinY = Math.min(b1[1], b2[1]), bMaxY = Math.max(b1[1], b2[1]);
        const overlap = Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY);
        if (overlap > 1e-9) return true;
      }
    }
  }
  return false;
}

// — validator

export interface ValidationError {
  message: string;
}

export function validateScenario(data: {
  countries: Country[];
  regions: Region[];
  leaders: LeadersForCountry[];
  parties: Party[];
  regimes: RegimeFact[];
  crossings: Crossing[];
  adjacency: Record<string, string[]>;
  scenario: unknown;
  geojson: unknown;
  regimeCoefficients: unknown;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const countries = data.countries as Country[];
  const regions = data.regions as Region[];
  const leaders = data.leaders as LeadersForCountry[];
  const parties = data.parties as Party[];
  const regimes = data.regimes as RegimeFact[];
  const crossings = data.crossings as Crossing[];
  const adjacency = data.adjacency as Record<string, string[]>;

  // countries
  if (!Array.isArray(countries) || countries.length !== 16) {
    errors.push(`countries must be array of 16, got ${Array.isArray(countries) ? countries.length : typeof countries}`);
  }
  const countryIds = new Set<string>();
  const countryCodes = new Set<string>();
  for (const c of countries ?? []) {
    if (!c.countryId || typeof c.countryId !== "string") errors.push(`country missing countryId: ${JSON.stringify(c)}`);
    else if (countryIds.has(c.countryId)) errors.push(`duplicate countryId: ${c.countryId}`);
    else countryIds.add(c.countryId);
    if (!c.countryCode) errors.push(`country ${c.countryId} missing countryCode`);
    else countryCodes.add(c.countryCode);
    if (c.isoA2 === undefined) errors.push(`country ${c.countryId} missing isoA2`);
    if (!c.capital) errors.push(`country ${c.countryId} missing capital`);
    if (!Array.isArray(c.capitalCoords) || c.capitalCoords.length !== 2) errors.push(`country ${c.countryId} capitalCoords must be [lon,lat]`);
    else {
      const [lon, lat] = c.capitalCoords;
      if (typeof lon !== "number" || typeof lat !== "number" || lon < -180 || lon > 180 || lat < -90 || lat > 90)
        errors.push(`country ${c.countryId} capitalCoords out of range: ${c.capitalCoords}`);
    }
    if (typeof c.electionMonth !== "number" || c.electionMonth < 1 || c.electionMonth > 12 || !Number.isInteger(c.electionMonth))
      errors.push(`country ${c.countryId} electionMonth must be integer 1-12, got ${c.electionMonth}`);
    if (typeof c.electionDay !== "number" || c.electionDay < 1 || c.electionDay > 28 || !Number.isInteger(c.electionDay))
      errors.push(`country ${c.countryId} electionDay must be integer 1-28, got ${c.electionDay}`);
    if (typeof c.landlocked !== "boolean") errors.push(`country ${c.countryId} landlocked must be boolean`);
    if (typeof c.island !== "boolean") errors.push(`country ${c.countryId} island must be boolean`);
    if (!Array.isArray(c.bbox) || c.bbox.length !== 4) errors.push(`country ${c.countryId} bbox must be [minLon,minLat,maxLon,maxLat]`);
    else {
      const [a, b, d, e] = c.bbox;
      if (!(a < d && b < e)) errors.push(`country ${c.countryId} bbox invalid: ${c.bbox}`);
    }
  }
  // landlocked check exactly 5
  const landlocked = countries.filter((c) => c.landlocked).map((c) => c.countryCode).sort();
  const expectedLandlocked = [...LANDLOCKED_CODES].sort();
  if (JSON.stringify(landlocked) !== JSON.stringify(expectedLandlocked)) {
    errors.push(`landlocked mismatch: expected ${expectedLandlocked.join(",")} got ${landlocked.join(",")}`);
  }
  const island = countries.filter((c) => c.island).map((c) => c.countryCode);
  if (!island.includes(ISLAND_CODE) || island.length !== 1) {
    errors.push(`island mismatch: expected [${ISLAND_CODE}] got [${island.join(",")}]`);
  }
  // bboxes no area overlap
  for (let i = 0; i < countries.length; i++) {
    for (let j = i + 1; j < countries.length; j++) {
      const a = countries[i], b = countries[j];
      if (bboxesOverlapArea(a.bbox as [number, number, number, number], b.bbox as [number, number, number, number])) {
        errors.push(`country bboxes overlap area: ${a.countryId} ${a.bbox} vs ${b.countryId} ${b.bbox}`);
      }
    }
  }

  // regions
  if (!Array.isArray(regions) || regions.length < 60 || regions.length > 120) {
    errors.push(`regions must be 60-120, got ${Array.isArray(regions) ? regions.length : typeof regions}`);
  }
  const regionIds = new Set<string>();
  const regionById = new Map<string, Region>();
  for (const r of regions ?? []) {
    if (!r.regionId) errors.push(`region missing regionId: ${JSON.stringify(r)}`);
    else if (regionIds.has(r.regionId)) errors.push(`duplicate regionId: ${r.regionId}`);
    else {
      regionIds.add(r.regionId);
      regionById.set(r.regionId, r);
    }
    if (!r.countryId) errors.push(`region ${r.regionId} missing countryId`);
    else if (!countryIds.has(r.countryId)) errors.push(`region ${r.regionId} has unknown countryId ${r.countryId}`);
    if (!r.countryCode) errors.push(`region ${r.regionId} missing countryCode`);
    if (!r.bbox || r.bbox.length !== 4) errors.push(`region ${r.regionId} bbox invalid`);
    if (!r.polygon || r.polygon.type !== "Polygon") errors.push(`region ${r.regionId} polygon must be Polygon`);
    else {
      const coords = r.polygon.coordinates;
      if (!Array.isArray(coords) || coords.length === 0 || !Array.isArray(coords[0]) || coords[0].length < 4)
        errors.push(`region ${r.regionId} polygon coordinates invalid`);
      else {
        const ring = coords[0];
        const first = ring[0], last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) errors.push(`region ${r.regionId} polygon ring not closed`);
      }
    }
    if (r.generated !== true) errors.push(`region ${r.regionId} must have generated:true (game abstraction)`);
    // regionId pattern countryCode + index
    const expectedPrefix = `${r.countryCode}-`;
    if (!r.regionId.startsWith(expectedPrefix)) errors.push(`region ${r.regionId} must start with ${expectedPrefix}`);
    else {
      const suffix = r.regionId.slice(expectedPrefix.length);
      if (!/^\d+$/.test(suffix)) errors.push(`region ${r.regionId} suffix must be numeric index`);
    }
    // bbox inside country bbox
    const country = countries.find((cc) => cc.countryId === r.countryId);
    if (country && r.bbox) {
      const [minLon, minLat, maxLon, maxLat] = r.bbox as [number, number, number, number];
      const [cMinLon, cMinLat, cMaxLon, cMaxLat] = country.bbox as [number, number, number, number];
      const eps = 1e-9;
      if (minLon < cMinLon - eps || maxLon > cMaxLon + eps || minLat < cMinLat - eps || maxLat > cMaxLat + eps) {
        errors.push(`region ${r.regionId} bbox ${r.bbox} outside country ${country.countryId} bbox ${country.bbox}`);
      }
    }
    if (!r.center || r.center.length !== 2) errors.push(`region ${r.regionId} center missing`);
    if (r.isCapitalRegion !== undefined && typeof r.isCapitalRegion !== "boolean") errors.push(`region ${r.regionId} isCapitalRegion must be boolean`);
  }
  // no overlaps between regions (area overlap)
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i], b = regions[j];
      if (bboxesOverlapArea(a.bbox as [number, number, number, number], b.bbox as [number, number, number, number])) {
        errors.push(`regions overlap area: ${a.regionId} ${a.bbox} vs ${b.regionId} ${b.bbox}`);
      }
    }
  }
  // adjacency
  if (!adjacency || typeof adjacency !== "object") {
    errors.push(`adjacency missing`);
  } else {
    for (const [regionId, neigh] of Object.entries(adjacency)) {
      if (!regionIds.has(regionId)) errors.push(`adjacency key ${regionId} unknown region`);
      if (!Array.isArray(neigh)) errors.push(`adjacency ${regionId} must be array`);
      else {
        for (const nb of neigh) {
          if (!regionIds.has(nb)) errors.push(`adjacency ${regionId} -> unknown ${nb}`);
          // symmetric
          const rev = adjacency[nb];
          if (!rev || !rev.includes(regionId)) errors.push(`adjacency not symmetric: ${regionId} -> ${nb} but not reverse`);
          // share edge (not just point) - only check if same country? For intra we enforce, for inter we allow not sharing? But spec says adjacency only by shared border, so enforce for all.
          if (regionIds.has(regionId) && regionIds.has(nb)) {
            const a = regionById.get(regionId)!;
            const b = regionById.get(nb)!;
            // only validate edge sharing if both exist; allow sea crossings separate, so cross-country adjacency should not be in adjacency list (should be in crossings)
            // To avoid false positive for cross-country logical adjacency, we enforce that adjacency entries must share edge geometrically.
            // Since our data has only intra-country adjacency, this will hold. If cross-country adjacency is present but not sharing edge, it would be flagged.
            const share = polygonsShareEdge(a.polygon.coordinates as number[][][], b.polygon.coordinates as number[][][]);
            if (!share) errors.push(`adjacency ${regionId} <-> ${nb} does not share border edge (must be by shared border, not center distance)`);
          }
        }
      }
    }
    // ensure UK island has no adjacency to other country's regions
    for (const r of regions.filter((rr) => rr.countryCode === "GB")) {
      const neigh = adjacency[r.regionId] ?? [];
      for (const nb of neigh) {
        const other = regionById.get(nb);
        if (other && other.countryCode !== "GB") errors.push(`island violation: GB region ${r.regionId} adjacent to ${nb} of ${other.countryCode} (must be island, only sea crossings)`);
      }
    }
  }

  // capitals: each country has at least one capital region
  for (const c of countries) {
    const regs = regions.filter((r) => r.countryId === c.countryId);
    if (regs.length === 0) errors.push(`country ${c.countryId} has no regions`);
    if (!regs.some((r) => r.isCapitalRegion)) errors.push(`country ${c.countryId} missing isCapitalRegion`);
  }

  // leaders
  if (!Array.isArray(leaders) || leaders.length !== 16) errors.push(`leaders must be 16 entries, got ${leaders?.length}`);
  else {
    for (const l of leaders) {
      if (!countryIds.has(l.countryId)) errors.push(`leaders entry unknown country ${l.countryId}`);
      if (!l.incumbent || typeof l.incumbent.name !== "string" || !l.incumbent.name.trim()) errors.push(`leaders ${l.countryId} incumbent missing name`);
      if (!l.incumbent.title) errors.push(`leaders ${l.countryId} incumbent missing title`);
      if (!l.incumbent.since || !isValidDateString(l.incumbent.since)) errors.push(`leaders ${l.countryId} incumbent since invalid date ${l.incumbent.since}`);
      if (!l.incumbent.source) errors.push(`leaders ${l.countryId} incumbent missing source`);
      if (!Array.isArray(l.pool) || l.pool.length < 2 || l.pool.length > 3) errors.push(`leaders ${l.countryId} pool must be 2-3 spares, got ${l.pool?.length}`);
      else {
        for (const p of l.pool) {
          if (!p.name || !p.title || !p.since || !p.source) errors.push(`leaders ${l.countryId} pool entry missing fields ${JSON.stringify(p)}`);
          if (p.since && !isValidDateString(p.since)) errors.push(`leaders ${l.countryId} pool since invalid ${p.since}`);
        }
      }
    }
  }

  // parties
  if (!Array.isArray(parties) || parties.length < 32) errors.push(`parties must be >=32 (2 per country), got ${parties?.length}`);
  else {
    const partiesByCountry = new Map<string, number>();
    for (const p of parties) {
      if (!countryIds.has(p.countryId)) errors.push(`party ${p.partyId} unknown country ${p.countryId}`);
      if (!p.partyId) errors.push(`party missing partyId`);
      if (!p.candidate) errors.push(`party ${p.partyId} missing candidate`);
      if (!p.regimePreference || !REGIME_IDS.has(p.regimePreference)) errors.push(`party ${p.partyId} regimePreference must be one of ${Array.from(REGIME_IDS).join(",")}, got ${p.regimePreference}`);
      if (!p.foreignStance || typeof p.foreignStance !== "object") errors.push(`party ${p.partyId} missing foreignStance`);
      else {
        for (const [k, v] of Object.entries(p.foreignStance)) {
          if (!countryCodes.has(k)) errors.push(`party ${p.partyId} foreignStance key ${k} unknown country`);
          if (typeof v !== "number" || v < -20 || v > 20) errors.push(`party ${p.partyId} foreignStance ${k} must be -20..20, got ${v}`);
        }
      }
      partiesByCountry.set(p.countryId, (partiesByCountry.get(p.countryId) ?? 0) + 1);
    }
    for (const c of countries) {
      const cnt = partiesByCountry.get(c.countryId) ?? 0;
      if (cnt < 2) errors.push(`country ${c.countryId} has <2 parties, got ${cnt}`);
    }
  }

  // regimes
  if (!Array.isArray(regimes) || regimes.length !== 4) errors.push(`regimes must be 4, got ${regimes?.length}`);
  else {
    const ids = new Set(regimes.map((r) => r.regimeId));
    for (const exp of REGIME_IDS) if (!ids.has(exp)) errors.push(`regimes missing ${exp}`);
    for (const r of regimes) {
      if (r.isGameLabel !== true) errors.push(`regime ${r.regimeId} must have isGameLabel:true`);
    }
  }

  // crossings
  if (!Array.isArray(crossings) || crossings.length < 1) errors.push(`crossings must have at least 1 (UK-France)`);
  else {
    const hasGBFR = crossings.some((cc) => (cc.fromCountryId === "GB" && cc.toCountryId === "FR") || (cc.fromCountryId === "FR" && cc.toCountryId === "GB"));
    if (!hasGBFR) errors.push(`crossings must include UK-France (GB-FR) sea crossing for island case`);
    for (const cr of crossings) {
      if (!regionIds.has(cr.fromRegionId)) errors.push(`crossing ${cr.crossingId} fromRegion ${cr.fromRegionId} unknown`);
      if (!regionIds.has(cr.toRegionId)) errors.push(`crossing ${cr.crossingId} toRegion ${cr.toRegionId} unknown`);
      if (cr.fromCountryId === cr.toCountryId) errors.push(`crossing ${cr.crossingId} must be between different countries`);
      if (cr.type !== "sea") errors.push(`crossing ${cr.crossingId} type must be sea`);
    }
  }

  // geojson
  if (!data.geojson || typeof data.geojson !== "object") errors.push(`geojson missing`);
  else {
    const gj = data.geojson as { type?: string; features?: unknown[] };
    if (gj.type !== "FeatureCollection") errors.push(`geojson type must be FeatureCollection`);
    if (!Array.isArray(gj.features) || gj.features.length !== 16) errors.push(`geojson must have 16 features, got ${gj.features?.length}`);
  }

  // scenario disputed note
  const sc = data.scenario as { disputedTerritoriesNote?: string; description?: string; startDate?: string };
  if (!sc || !sc.disputedTerritoriesNote) errors.push(`scenario missing disputedTerritoriesNote (must mark as in NE)`);
  if (sc && sc.startDate !== START_DATE) errors.push(`scenario startDate must be ${START_DATE}, got ${sc.startDate}`);

  return { ok: errors.length === 0, errors };
}

export function loadScenario(): Scenario {
  const countries = countriesRaw as unknown as Country[];
  const regions = regionsRaw as unknown as Region[];
  const leaders = leadersRaw as unknown as LeadersForCountry[];
  const parties = partiesRaw as unknown as Party[];
  const regimes = regimesRaw as unknown as RegimeFact[];
  const crossings = crossingsRaw as unknown as Crossing[];
  const adjacency = adjacencyRaw as unknown as Record<string, string[]>;
  const scenario = scenarioRaw as unknown as Scenario;
  const geojson = geojsonRaw as unknown;
  const regimeCoefficients = regimeCoeffsRaw as unknown;

  const res = validateScenario({ countries, regions, leaders, parties, regimes, crossings, adjacency, scenario, geojson, regimeCoefficients });
  if (!res.ok) {
    throw new Error(`Scenario validation failed:\n- ${res.errors.join("\n- ")}`);
  }
  return {
    scenarioId: (scenario as { scenarioId: string }).scenarioId,
    name: (scenario as { name: string }).name,
    nameRu: (scenario as { nameRu: string }).nameRu,
    version: (scenario as { version: string }).version,
    description: (scenario as { description: string }).description,
    descriptionRu: (scenario as { descriptionRu: string }).descriptionRu,
    disputedTerritoriesNote: (scenario as { disputedTerritoriesNote: string }).disputedTerritoriesNote,
    startDate: (scenario as { startDate: string }).startDate,
    electionIntervalYears: (scenario as { electionIntervalYears: number }).electionIntervalYears,
    totalCountries: countries.length,
    totalRegions: regions.length,
    generated: true,
    countries,
    regions,
    leaders,
    parties,
    regimes,
    crossings,
    adjacency,
    geojson,
    regimeCoefficients,
  };
}

// query helpers (public seam)

export function getCountry(scenario: Scenario, countryId: string): Country | undefined {
  return scenario.countries.find((c) => c.countryId === countryId);
}

export function getRegion(scenario: Scenario, regionId: string): Region | undefined {
  return scenario.regions.find((r) => r.regionId === regionId);
}

export function getRegionsByCountry(scenario: Scenario, countryId: string): Region[] {
  return scenario.regions.filter((r) => r.countryId === countryId);
}

export function getAdjacentRegions(scenario: Scenario, regionId: string): Region[] {
  const ids = scenario.adjacency[regionId] ?? [];
  return ids.map((id) => getRegion(scenario, id)!).filter(Boolean);
}

export function getCrossingsForCountry(scenario: Scenario, countryId: string): Crossing[] {
  return scenario.crossings.filter((c) => c.fromCountryId === countryId || c.toCountryId === countryId);
}

export function areRegionsAdjacent(scenario: Scenario, a: string, b: string): boolean {
  return (scenario.adjacency[a] ?? []).includes(b);
}

export function isSeaCrossing(scenario: Scenario, fromRegionId: string, toRegionId: string): boolean {
  return scenario.crossings.some(
    (c) =>
      (c.fromRegionId === fromRegionId && c.toRegionId === toRegionId) ||
      (c.fromRegionId === toRegionId && c.toRegionId === fromRegionId)
  );
}

export function getLeadersForCountry(scenario: Scenario, countryId: string): LeadersForCountry | undefined {
  return scenario.leaders.find((l) => l.countryId === countryId);
}

export function getPartiesForCountry(scenario: Scenario, countryId: string): Party[] {
  return scenario.parties.filter((p) => p.countryId === countryId);
}

export function getRegime(scenario: Scenario, regimeId: string): RegimeFact | undefined {
  return scenario.regimes.find((r) => r.regimeId === regimeId);
}
