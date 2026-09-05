import { describe, it, expect } from "vitest";
import { createSim } from "../engine.js";
import { saveGame, loadGame, deserializeSave, SAVE_VERSION } from "../save.js";

describe("save/load v1 (T8 persistence)", () => {
  it("roundtrip preserves state — saveGame/loadGame identical snapshot and continued determinism", () => {
    const sim = createSim({ seed: 777 });
    // do some actions to mutate many subsystems
    sim.setPlayerCountryId("GB");
    sim.dispatch({ type: "setTax", payload: { countryId: "GB", taxRate: 0.3 } });
    sim.dispatch({ type: "setWeights", payload: { countryId: "GB", weights: { defense: 0.4, infra: 0.6, social: 0.5, edu: 0.5 } } });
    // start project in first controlled region
    const ecoGB = sim.getEconomy("GB")!;
    const region = Array.from(ecoGB.controlledRegions)[0];
    sim.dispatch({ type: "startProject", payload: { countryId: "GB", regionId: region, projectType: "regionInfra" } });
    // recruit unit
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-1", personnel: 1200, equipment: 0.8 } });
    sim.tick(14); // hiring time
    // move if possible: GB-1 -> GB-2 adjacency?
    // Declare war GB vs FR and do short tick
    sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    sim.tick(5);

    const save = saveGame(sim);
    expect(save.version).toBe(1);
    expect(save.seed).toBe(777);
    expect(save.date).toBe(sim.getDate());
    expect(save.daysElapsed).toBe(sim.getDaysElapsed());
    expect(save.tickCount).toBe(sim.getTickCount());
    expect(save.economies["GB"]).toBeTruthy();
    expect(save.economies["GB"].treasury).toBe(sim.getEconomy("GB")!.treasury);
    expect(save.regions.length).toBeGreaterThan(0);
    expect(save.units.length).toBe(sim.getUnits().length);
    expect(save.wars.length).toBe(sim.getWars().length);
    expect(save.logTail.length).toBeGreaterThan(0);
    expect(save.playerCountryId).toBe("GB");
    expect(save.politics["GB"]).toBeTruthy();

    // serialize + deserialize
    const json = JSON.stringify(save);
    const loaded = loadGame(json);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const sim2 = loaded.sim;

    // snapshots should be deep equal (except maybe log full vs tail but tail preserved)
    const snap1 = sim.getSnapshot();
    const snap2 = sim2.getSnapshot();
    expect(snap2.date).toBe(snap1.date);
    expect(snap2.daysElapsed).toBe(snap1.daysElapsed);
    expect(snap2.tickCount).toBe(snap1.tickCount);
    expect(snap2.seed).toBe(snap1.seed);
    expect(snap2.economies).toEqual(snap1.economies);
    expect(snap2.countryEconomy).toEqual(snap1.countryEconomy);
    expect(snap2.regions?.sort((a,b)=>a.regionId.localeCompare(b.regionId))).toEqual(snap1.regions?.sort((a,b)=>a.regionId.localeCompare(b.regionId)));
    expect(snap2.units?.sort((a,b)=>a.unitId.localeCompare(b.unitId))).toEqual(snap1.units?.sort((a,b)=>a.unitId.localeCompare(b.unitId)));
    expect(snap2.wars).toEqual(snap1.wars);
    expect(snap2.threats).toEqual(snap1.threats);
    expect(snap2.politics).toEqual(snap1.politics);
    expect(snap2.customState).toEqual(snap1.customState);
    // rng state preserved
    expect(sim2.getRngState()).toBe(sim.getRngState());
    expect(sim2.getPlayerCountryId()).toBe("GB");

    // continued determinism: tick both 10 days, no further commands, should stay equal
    sim.tick(10);
    sim2.tick(10);
    expect(sim.getSnapshot()).toEqual(sim2.getSnapshot());
    expect(sim.getEventLog().slice(-5)).toEqual(sim2.getEventLog().slice(-5));
  });

  it("local slots + export/import file shape correct — save contains version/seed/date/countries/regions/units/elections/logTail", () => {
    const sim = createSim({ seed: 42 });
    sim.tick(30);
    const save = saveGame(sim);
    // required fields per spec
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.seed).toBe(42);
    expect(save.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(save.economies).length).toBe(16); // 16 countries
    expect(save.regions.length).toBeGreaterThanOrEqual(60);
    expect(save.regions.length).toBeLessThanOrEqual(120);
    // units may be 0 initially
    expect(Array.isArray(save.units)).toBe(true);
    // elections -> politics nextElectionDate
    expect(save.politics["GB"].nextElectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(save.logTail)).toBe(true);
    // json exportable
    const json = JSON.stringify(save);
    expect(json.length).toBeGreaterThan(1000);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
  });

  it("broken save = clear error without crash — invalid JSON", () => {
    const res = loadGame("{ not json");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/повреждён|corrupted|invalid JSON/i);
    }
  });

  it("broken save = clear error — missing version or wrong shape", () => {
    const res1 = loadGame(JSON.stringify({ foo: "bar" }));
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.error).toMatch(/повреждён|corrupted|несовместим|incompatible/i);

    const res2 = loadGame(JSON.stringify({ version: 1, seed: "not-a-number", date: "2026-01-01", daysElapsed: 0, tickCount: 0, rngState: 0, economies: {}, regions: [], units: [], wars: [], politics: {}, relations: {}, trust: {}, threats: {}, countryEconomy: {}, logTail: [], customState: {}, nextIds: { nextUnitSeq:1, nextProjectId:1, nextWarId:1 } }));
    expect(res2.ok).toBe(false);
  });

  it("incompatible version error — expected version 1, got 999", () => {
    const sim = createSim({ seed: 1 });
    const save = saveGame(sim);
    const bad = { ...save, version: 999 };
    const res = loadGame(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/несовместим|incompatible/i);
      expect(res.error).toMatch(/999/);
      expect(res.error).toMatch(/1/);
    }
  });

  it("deserializeSave validates and returns clear Russian/English error", () => {
    const badJson = JSON.stringify({ version: 2, seed: 123, date: "bad-date", daysElapsed: -1, tickCount: 0, rngState: 0, economies: {}, regions: [], units: [], wars: [], politics: {}, relations: {}, trust: {}, threats: {}, countryEconomy: {}, logTail: [] });
    const res = deserializeSave(badJson);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeTruthy();
  });

  it("slot save/load via localStorage (jsdom) — no crash, clear error on empty slot", async () => {
    const { saveToSlot, loadFromSlot } = await import("../save.js");
    const sim = createSim({ seed: 101 });
    sim.tick(2);
    // ensure localStorage available (jsdom)
    if (typeof localStorage === "undefined") return;
    localStorage.clear();
    const sRes = saveToSlot(1, sim);
    expect(sRes.ok).toBe(true);
    const lRes = loadFromSlot(1);
    expect(lRes.ok).toBe(true);
    if (lRes.ok) {
      expect(lRes.sim.getDate()).toBe(sim.getDate());
      expect(lRes.sim.getSeed()).toBe(sim.getSeed());
    }
    const empty = loadFromSlot(2);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/пуст|empty/i);
  });

  it("file export/import roundtrip — export JSON then import", async () => {
    const sim = createSim({ seed: 202 });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 1000, equipment: 0.8 } });
    sim.tick(14);
    const save = saveGame(sim);
    const json = JSON.stringify(save);
    // simulate file import via loadGame
    const res = loadGame(json);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sim.getUnits().length).toBe(sim.getUnits().length);
      expect(res.sim.getSnapshot().units).toEqual(sim.getSnapshot().units);
    }
  });
});
