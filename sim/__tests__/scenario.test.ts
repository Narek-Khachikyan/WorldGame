import { describe, it, expect } from "vitest";
import {
  loadScenario,
  validateScenario,
  nextElectionDate,
  getNextElectionDateForCountry,
  getAdjacentRegions,
  areRegionsAdjacent,
  isSeaCrossing,
  LANDLOCKED_CODES,
  ISLAND_CODE,
} from "../scenario.js";
import countries from "../../data/countries.json";
import regions from "../../data/regions.json";
import leaders from "../../data/leaders.json";
import parties from "../../data/parties.json";
import regimes from "../../data/regimes.json";
import crossings from "../../data/crossings.json";
import adjacency from "../../data/adjacency.json";
import scenario from "../../data/scenario.json";
import geojson from "../../data/ne_50m_admin_0_countries.json";
import regimeCoeffs from "../../rules/regimes.json";

describe("scenario loader: public seam load → validate → query", () => {
  it("loads offline without network and validates", () => {
    const sc = loadScenario();
    expect(sc.countries.length).toBe(16);
    expect(sc.regions.length).toBeGreaterThanOrEqual(60);
    expect(sc.regions.length).toBeLessThanOrEqual(120);
    expect(sc.totalCountries).toBe(16);
    expect(sc.startDate).toBe("2026-01-01");
    // geojson local
    expect((sc.geojson as { type: string }).type).toBe("FeatureCollection");
    expect((sc.geojson as { features: unknown[] }).features.length).toBe(16);
  });

  it("geodata local, sources fixed, attribution", () => {
    const sc = loadScenario();
    expect(scenario.sources[0].name).toMatch(/Natural Earth/);
    expect(scenario.sources[0].version).toBe("5.1.0");
    expect(scenario.sources[0].license).toMatch(/Public Domain/);
    expect(scenario.sources[0].localPath).toBe("data/ne_50m_admin_0_countries.geojson");
    // no hotlinks in leaders
    for (const l of leaders as unknown as Array<{ incumbent: { portrait: unknown } }>) {
      expect(l.incumbent.portrait).toBeNull();
    }
  });

  it("16 countries with stable IDs, capitals, electionMonth/Day 1-12/1-28", () => {
    const sc = loadScenario();
    const ids = sc.countries.map((c) => c.countryId).sort();
    expect(ids).toEqual(["AT","BY","CZ","DE","ES","FR","GB","GR","HU","IT","PL","RO","RS","SE","TR","UA"]);
    for (const c of sc.countries) {
      expect(c.capital).toBeTruthy();
      expect(c.capitalCoords.length).toBe(2);
      expect(c.electionMonth).toBeGreaterThanOrEqual(1);
      expect(c.electionMonth).toBeLessThanOrEqual(12);
      expect(c.electionDay).toBeGreaterThanOrEqual(1);
      expect(c.electionDay).toBeLessThanOrEqual(28);
      // countryId stable ISO-ish
      expect(c.countryCode).toBe(c.countryId);
    }
  });

  it("60-120 regions inside borders, no overlaps, generated:true, correct id pattern", () => {
    const sc = loadScenario();
    expect(sc.regions.length).toBe(64); // 4 per country
    for (const r of sc.regions) {
      expect(r.generated).toBe(true);
      expect(r.regionId).toBe(`${r.countryCode}-${r.regionId.split("-")[1]}`);
      // inside country bbox
      const country = sc.countries.find((c) => c.countryId === r.countryId)!;
      const [minLon, minLat, maxLon, maxLat] = r.bbox;
      const [cMinLon, cMinLat, cMaxLon, cMaxLat] = country.bbox;
      expect(minLon).toBeGreaterThanOrEqual(cMinLon - 1e-9);
      expect(maxLon).toBeLessThanOrEqual(cMaxLon + 1e-9);
      expect(minLat).toBeGreaterThanOrEqual(cMinLat - 1e-9);
      expect(maxLat).toBeLessThanOrEqual(cMaxLat + 1e-9);
    }
    // no overlaps via bbox area overlap
    for (let i = 0; i < sc.regions.length; i++) {
      for (let j = i + 1; j < sc.regions.length; j++) {
        const a = sc.regions[i], b = sc.regions[j];
        const xOverlap = Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]);
        const yOverlap = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]);
        const areaOverlap = xOverlap > 1e-9 && yOverlap > 1e-9;
        expect(areaOverlap, `overlap ${a.regionId} vs ${b.regionId}`).toBe(false);
      }
    }
  });

  it("adjacency only by shared border (not center distance)", () => {
    const sc = loadScenario();
    // intra-country adjacency shares edge
    const gb1 = sc.regions.find((r) => r.regionId === "GB-1")!;
    const gb2 = sc.regions.find((r) => r.regionId === "GB-2")!;
    const gb4 = sc.regions.find((r) => r.regionId === "GB-4")!;
    // GB-1 adjacent to GB-2 and GB-3, but not to GB-4 (diagonal, centers close but no shared edge)
    expect(areRegionsAdjacent(sc, "GB-1", "GB-2")).toBe(true);
    expect(areRegionsAdjacent(sc, "GB-1", "GB-4")).toBe(false); // diagonal, would be close via distance but not share border
    // also GB-1 vs DE-1 should not be adjacent (different countries, gap)
    expect(areRegionsAdjacent(sc, "GB-1", "DE-1")).toBe(false);
    expect(isSeaCrossing(sc, "GB-2", "FR-1")).toBe(true); // sea crossing separate
    expect(isSeaCrossing(sc, "GB-1", "GB-2")).toBe(false);

    // adjacency list matches shared edge geometrically (validate internal)
    const adjFR1 = getAdjacentRegions(sc, "FR-1").map((r) => r.regionId).sort();
    // FR 2x2 grid: FR-1 adjacent to FR-2 and FR-3 only
    expect(adjFR1).toEqual(["FR-2", "FR-3"]);
  });

  it("island and landlocked correct (UK island, 5 landlocked)", () => {
    const sc = loadScenario();
    // UK island: no adjacency to foreign regions
    for (const r of sc.regions.filter((rr) => rr.countryCode === "GB")) {
      const neigh = (adjacency as Record<string, string[]>)[r.regionId] ?? [];
      for (const nb of neigh) {
        const other = sc.regions.find((rr) => rr.regionId === nb)!;
        expect(other.countryCode, `GB ${r.regionId} should not be adjacent to ${nb}`).toBe("GB");
      }
    }
    // landlocked set
    const landlocked = sc.countries.filter((c) => c.landlocked).map((c) => c.countryCode).sort();
    expect(landlocked).toEqual([...LANDLOCKED_CODES].sort());
    expect(sc.countries.find((c) => c.countryCode === ISLAND_CODE)!.island).toBe(true);
    // coastal check: landlocked countries have no sea-adjacent? In our abstraction, they are flagged; geometry may have gaps but flag is authoritative
    expect(sc.countries.filter((c) => c.landlocked).length).toBe(5);
  });

  it("capitals, leaders, parties, regimes load and validate", () => {
    const sc = loadScenario();
    // leaders: 1 incumbent +2-3 pool per country
    for (const l of sc.leaders) {
      expect(l.incumbent.name).toBeTruthy();
      expect(l.incumbent.title).toBeTruthy();
      expect(l.incumbent.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(l.incumbent.source).toBeTruthy();
      expect(l.pool.length).toBeGreaterThanOrEqual(2);
      expect(l.pool.length).toBeLessThanOrEqual(3);
    }
    expect(sc.leaders.length).toBe(16);
    // parties: 2+ per country, regimePreference valid, foreignStance -20..20
    for (const c of sc.countries) {
      const ps = sc.parties.filter((p) => p.countryId === c.countryId);
      expect(ps.length).toBeGreaterThanOrEqual(2);
      for (const p of ps) {
        expect(["liberalDemocracy","electoralDemocracy","authoritarian","oneParty"]).toContain(p.regimePreference);
        for (const v of Object.values(p.foreignStance)) {
          expect(v).toBeGreaterThanOrEqual(-20);
          expect(v).toBeLessThanOrEqual(20);
        }
      }
    }
    // regimes 4
    expect(sc.regimes.length).toBe(4);
    expect(sc.regimes.map((r)=>r.regimeId).sort()).toEqual(["authoritarian","electoralDemocracy","liberalDemocracy","oneParty"]);
    for (const r of sc.regimes) expect(r.isGameLabel).toBe(true);
    // regime coefficients separated in rules/
    expect((regimeCoeffs as { regimes: Record<string, unknown> }).regimes).toBeTruthy();
    expect(Object.keys((regimeCoeffs as { regimes: Record<string, unknown> }).regimes).sort()).toEqual(["authoritarian","electoralDemocracy","liberalDemocracy","oneParty"]);
  });

  it("disputed territories as in NE with note", () => {
    const sc = loadScenario();
    expect(sc.disputedTerritoriesNote).toMatch(/Natural Earth/);
    expect(sc.description).toMatch(/Disputed territories/);
    expect(sc.description).toMatch(/Crimea/);
  });

  it("election dates stable, nextElectionDate from 2026-01-01 interval 5 years, day 1-28", () => {
    const sc = loadScenario();
    // check GB election 5/2
    const gb = sc.countries.find((c) => c.countryCode === "GB")!;
    expect(gb.electionMonth).toBe(5);
    expect(gb.electionDay).toBe(2);
    expect(nextElectionDate(5, 2, "2026-01-01")).toBe("2026-05-02");
    expect(nextElectionDate(5, 2, "2026-05-03")).toBe("2031-05-02");
    expect(nextElectionDate(5, 2, "2031-05-02")).toBe("2031-05-02");
    expect(nextElectionDate(5, 2, "2031-05-03")).toBe("2036-05-02");
    // per country via helper
    expect(getNextElectionDateForCountry(gb, "2026-01-01")).toBe("2026-05-02");
    // all countries next election >= start and month/day match
    for (const c of sc.countries) {
      const next = getNextElectionDateForCountry(c, "2026-01-01");
      expect(next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [, m, d] = next.split("-").map(Number);
      expect(m).toBe(c.electionMonth);
      expect(d).toBe(c.electionDay);
      // interval 5 years: year %5 offset from 2026?
      const year = Number(next.slice(0,4));
      expect((year - 2026) % 5).toBe(0);
    }
    // edge: electionDay 28 max
    expect(() => nextElectionDate(2, 29, "2026-01-01")).toThrow();
  });

  it("sea crossings separate list, minimum UK-France", () => {
    const sc = loadScenario();
    expect(sc.crossings.length).toBeGreaterThanOrEqual(1);
    const hasGBFR = sc.crossings.some((c)=> (c.fromCountryId==="GB" && c.toCountryId==="FR") || (c.fromCountryId==="FR" && c.toCountryId==="GB"));
    expect(hasGBFR).toBe(true);
    for (const cr of sc.crossings) {
      expect(cr.type).toBe("sea");
      expect(sc.regions.find((r)=>r.regionId===cr.fromRegionId)).toBeTruthy();
      expect(sc.regions.find((r)=>r.regionId===cr.toRegionId)).toBeTruthy();
    }
  });

  it("stable entity ids", () => {
    const sc = loadScenario();
    // countryId stable
    for (const c of sc.countries) expect(c.countryId).toBe(c.countryCode);
    // regionId pattern countryCode + index
    for (const r of sc.regions) expect(r.regionId).toMatch(/^[A-Z]{2}-\d+$/);
    // unique
    expect(new Set(sc.regions.map((r)=>r.regionId)).size).toBe(sc.regions.length);
    expect(new Set(sc.countries.map((c)=>c.countryId)).size).toBe(16);
  });

  it("validator rejects broken data with clear error", () => {
    const sc = loadScenario();
    // duplicate country
    const badCountries = [...sc.countries, sc.countries[0]];
    let res = validateScenario({ countries: badCountries as unknown as typeof sc.countries, regions: sc.regions, leaders: sc.leaders, parties: sc.parties, regimes: sc.regimes, crossings: sc.crossings, adjacency: sc.adjacency, scenario: sc, geojson: sc.geojson, regimeCoefficients: sc.regimeCoefficients });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/duplicate/i);

    // electionDay 31 invalid
    const badCountries2 = sc.countries.map((c)=> c.countryId==="GB" ? { ...c, electionDay:31 } : c);
    res = validateScenario({ countries: badCountries2 as unknown as typeof sc.countries, regions: sc.regions, leaders: sc.leaders, parties: sc.parties, regimes: sc.regimes, crossings: sc.crossings, adjacency: sc.adjacency, scenario: sc, geojson: sc.geojson, regimeCoefficients: sc.regimeCoefficients });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/electionDay/);

    // overlapping regions
    const badRegions = sc.regions.map((r,i)=> i===0 ? { ...r, bbox: sc.regions[1].bbox } : r);
    res = validateScenario({ countries: sc.countries, regions: badRegions as unknown as typeof sc.regions, leaders: sc.leaders, parties: sc.parties, regimes: sc.regimes, crossings: sc.crossings, adjacency: sc.adjacency, scenario: sc, geojson: sc.geojson, regimeCoefficients: sc.regimeCoefficients });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/overlap/i);

    // missing landlocked
    const badCountries3 = sc.countries.map((c)=> ({ ...c, landlocked:false }));
    res = validateScenario({ countries: badCountries3 as unknown as typeof sc.countries, regions: sc.regions, leaders: sc.leaders, parties: sc.parties, regimes: sc.regimes, crossings: sc.crossings, adjacency: sc.adjacency, scenario: sc, geojson: sc.geojson, regimeCoefficients: sc.regimeCoefficients });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/landlocked/);
  });
});
