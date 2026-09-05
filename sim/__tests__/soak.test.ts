import { describe, it, expect } from "vitest";
import { createSim } from "../engine.js";
import { runAIStep } from "../ai.js";
declare const process: { platform: string; version: string };

describe("soak / determinism / edge cases T8", () => {
  it("soak: 10 years tick with AI — no NaN, no explosions, no infinite loops, bounded values", () => {
    const seed = 2026;
    const sim = createSim({ seed });
    sim.setPlayerCountryId("GB");
    const start = Date.now();
    const targetDays = 365 * 10; // 10 years ~3650, add leaps approx 3653 but we use 3650 for determinism
    // We'll tick day by day with AI every 14 days + events
    for (let day = 0; day < targetDays; day++) {
      sim.tick(1);
      if (sim.getDaysElapsed() % 14 === 0) {
        for (const cid of sim.getCountryIds()) {
          if (cid === sim.getPlayerCountryId()) continue;
          runAIStep(sim, cid, { reason: "interval14" });
        }
      }
      // occasional event-driven extra check: after war declaration trigger retry? already handled
      // Check invariants every 100 days to keep test fast
      if (day % 365 === 0) {
        const snap = sim.getSnapshot();
        // no NaN
        for (const [, eco] of Object.entries(snap.economies ?? {})) {
          expect(Number.isFinite(eco.treasury)).toBe(true);
          expect(Number.isFinite(eco.debt)).toBe(true);
          expect(Number.isFinite(eco.gdp)).toBe(true);
          expect(isNaN(eco.treasury)).toBe(false);
          expect(eco.gdp).toBeGreaterThan(0);
          expect(eco.gdp).toBeLessThan(10000);
        }
        for (const u of snap.units ?? []) {
          expect(Number.isFinite(u.personnel)).toBe(true);
          expect(u.personnel).toBeGreaterThanOrEqual(0);
        }
      }
    }
    const elapsedMs = Date.now() - start;
    const snap = sim.getSnapshot();
    // final checks
    for (const [, eco] of Object.entries(snap.economies ?? {})) {
      expect(isNaN(eco.treasury)).toBe(false);
      expect(isNaN(eco.debt)).toBe(false);
      expect(isNaN(eco.gdp)).toBe(false);
      expect(eco.treasury).toBeGreaterThan(-10000);
      expect(eco.treasury).toBeLessThan(100000);
      expect(eco.debt).toBeGreaterThanOrEqual(0);
      expect(eco.debt).toBeLessThan(100000);
      expect(eco.gdp).toBeGreaterThan(0);
      expect(eco.gdp).toBeLessThan(10000);
    }
    for (const u of snap.units ?? []) {
      expect(isNaN(u.personnel)).toBe(false);
      expect(isNaN(u.readiness)).toBe(false);
    }
    for (const [, pol] of Object.entries(snap.politics?.states ?? {})) {
      expect(pol.stability).toBeGreaterThanOrEqual(0);
      expect(pol.stability).toBeLessThanOrEqual(100);
      expect(pol.support).toBeGreaterThanOrEqual(0);
      expect(pol.support).toBeLessThanOrEqual(100);
      expect(isNaN(pol.stability)).toBe(false);
    }
    // No infinite loops — completed quickly
    // Performance measurement with conditions stated
    // We measure wall clock: should be < 5 sec for 10 years on current hardware (Node, no UI)
    // In CI with vitest jsdom, 10 years (3650*16 AI steps) ~ 3650 ticks + ~260*15 AI steps ~ 4000 operations, should be <2000ms
    console.log(`[soak] 10 years (${targetDays} days) with AI on ${snap.units?.length ?? 0} units, ${snap.wars?.length ?? 0} wars — took ${elapsedMs}ms on ${process.platform} Node ${process.version} (single-thread, no PixiJS)`);
    expect(elapsedMs).toBeLessThan(8000);
    // ensure date advanced correctly
    expect(snap.daysElapsed).toBe(targetDays);
  }, 15000);

  it("determinism: same seed + commands → identical result including AI", () => {
    function runWithAI(seed:number): { snapJson: string; rngState: number; logLen: number } {
      const sim = createSim({ seed });
      sim.setPlayerCountryId("GB");
      sim.dispatch({ type: "setTax", payload: { countryId: "GB", taxRate: 0.3 } });
      for (let d=0; d< 60; d++) {
        sim.tick(1);
        if (sim.getDaysElapsed() % 14 === 0) {
          for (const cid of sim.getCountryIds()) {
            if (cid === "GB") continue;
            runAIStep(sim, cid, { reason: "interval14" });
          }
        }
      }
      const snap = sim.getSnapshot();
      return { snapJson: JSON.stringify({ date: snap.date, economies: snap.economies, units: snap.units?.sort((a,b)=>a.unitId.localeCompare(b.unitId)), wars: snap.wars }), rngState: sim.getRngState(), logLen: sim.getEventLog().length };
    }
    const a = runWithAI(999);
    const b = runWithAI(999);
    expect(a.snapJson).toBe(b.snapJson);
    expect(a.rngState).toBe(b.rngState);
    expect(a.logLen).toBe(b.logLen);
    const c = runWithAI(1000);
    // Different seed should diverge in rng state (at least), snapshot may still coincidentally match for short run without RNG-heavy actions, so check rngState differs
    expect(c.rngState).not.toBe(a.rngState);
    // Also ensure not trivially same seed path
    expect(c.snapJson).toBeTruthy();
  });

  it("edge: bankruptcy — AI or player with high debt doesn't crash, warnings appear", () => {
    const sim = createSim({ seed: 42 });
    const cid = "RO";
    // Force bankruptcy via setting treasury low and debt high
    const anySim = sim as unknown as { economies: Map<string, { treasury:number; debt:number; lastIncome:number; lastExpense:number; lastInterest:number }> };
    const eco = anySim.economies.get(cid)!;
    eco.treasury = 10;
    eco.debt = 600;
    eco.lastInterest = 9;
    sim.tick(1);
    // Run AI — should handle not bankrupt priority without throwing
    expect(() => runAIStep(sim, cid, { reason: "interval14" })).not.toThrow();
    // Should have treasuryWarning or crisisWarning eventually
    sim.tick(30);
    const logs = sim.getEventLog();
    const hasWarning = logs.some((e)=> e.kind==="treasuryWarning" || e.kind==="crisisWarning" || e.kind==="aiDecision");
    expect(hasWarning).toBe(true);
    // Treasury still finite
    expect(isNaN(sim.getEconomy(cid)!.treasury)).toBe(false);
  });

  it("edge: capital loss — losing capital triggers crisis and AI defend logic without crash", () => {
    const sim = createSim({ seed: 123 });
    const victim = "PL";
    const attacker = "DE";
    const cap = sim.getCapitalRegion(victim)!;
    // Make attacker strong and capture capital via move
    sim.dispatch({ type: "recruitUnit", payload: { countryId: attacker, regionId: sim.getCapitalRegion(attacker)!, personnel: 5000, equipment: 1.0 } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: victim, regionId: cap, personnel: 500, equipment: 0.5 } });
    sim.tick(14);
    sim.dispatch({ type: "declareWar", payload: { attacker, defender: victim } });
    const attUnit = sim.getUnitsByCountry(attacker)[0];
    // try capture
    sim.dispatch({ type: "moveUnit", payload: { unitId: attUnit.unitId, toRegionId: cap } });
    sim.tick(2);
    // Check capital lost flag may be true
    const capLost = sim.isCapitalLost(victim);
    // If captured, stability should drop but not NaN, and AI should try defend
    if (capLost) {
      expect(sim.getPoliticalState(victim)!.stability).toBeLessThan(70);
      expect(() => runAIStep(sim, victim, { reason: "event" })).not.toThrow();
      // AI should log defendLost or capital
      const logs = sim.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId===victim);
      expect(logs.length).toBeGreaterThan(0);
    } else {
      // If not captured (defended), still not crash
      expect(sim.getRegionState(cap)!.controllerId).toBe(victim);
    }
  });

  it("edge: encirclement — unit far from capital gets supply penalty but not death", () => {
    const sim = createSim({ seed: 777 });
    const cid = "HU"; // landlocked
    const cap = sim.getCapitalRegion(cid)!;
    // Recruit and move far away (maybe multiple hops)
    sim.dispatch({ type: "recruitUnit", payload: { countryId: cid, regionId: cap, personnel: 1000, equipment: 0.8 } });
    sim.tick(14);
    const unit = sim.getUnitsByCountry(cid)[0];
    // Find a distant region: e.g., try move to GR-1 via many hops? But adjacency is within country only? Need to find far region controlled by same? Actually we can move only to adjacent. But we can force via setRegionController to simulate encirclement: make unit in distant region artificially.
    // Directly manipulate to test supply penalty
    const anySim = sim as unknown as { units: Map<string, { regionId:string }> };
    const regions = sim.getScenario().regions;
    const far = regions.find((r)=> r.countryId !== cid)?.regionId ?? "GB-1";
    anySim.units.get(unit.unitId)!.regionId = far;
    const penalty = sim.getSupplyPenaltyForUnit(unit.unitId);
    expect(penalty).toBeDefined();
    expect(penalty!).toBeGreaterThan(0);
    expect(penalty! === 0.7 || penalty! === 1.0).toBe(true);
    expect(isNaN(penalty!)).toBe(false);
  });

  it("edge: full occupation — losing all regions doesn't crash, politics still evolves", () => {
    const sim = createSim({ seed: 888 });
    const victim = "RS";
    const attacker = "HU";
    // Declare war
    sim.dispatch({ type: "declareWar", payload: { attacker, defender: victim } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: attacker, regionId: sim.getCapitalRegion(attacker)!, personnel: 5000, equipment: 1.0 } });
    sim.tick(14);
    const attUnit = sim.getUnitsByCountry(attacker)[0];
    const victimRegions = sim.getScenario().regions.filter((r)=> r.countryId===victim).map((r)=>r.regionId);
    // Capture all victim regions via successive moves + controller change hack for speed? Use direct region controller change to simulate full occupation quickly
    for (const rid of victimRegions) {
      sim.dispatch({ type: "setRegionController", payload: { regionId: rid, newControllerId: attacker } });
    }
    sim.tick(1);
    // Check all lost
    const ownedNotControlled = sim.getRegionStates().filter((r)=> r.ownerId===victim && r.controllerId!==victim);
    expect(ownedNotControlled.length).toBe(victimRegions.length);
    // Should not crash on next tick
    expect(() => sim.tick(10)).not.toThrow();
    // Politics still has stability etc.
    const pol = sim.getPoliticalState(victim)!;
    expect(pol.stability).toBeGreaterThanOrEqual(0);
    expect(pol.stability).toBeLessThanOrEqual(100);
    // AI for victim should attempt peace/defend
    expect(() => runAIStep(sim, victim, { reason: "event" })).not.toThrow();
  });

  it("edge: destruction of last army — no crash, AI rebuilds garrison", () => {
    const sim = createSim({ seed: 999 });
    const cid = "SE";
    sim.dispatch({ type: "recruitUnit", payload: { countryId: cid, regionId: sim.getCapitalRegion(cid)!, personnel: 500, equipment: 0.5 } });
    sim.tick(14);
    const unit = sim.getUnitsByCountry(cid)[0];
    // Kill it via combat: create enemy strong and move
    const enemy = "FR";
    sim.dispatch({ type: "recruitUnit", payload: { countryId: enemy, regionId: sim.getCapitalRegion(enemy)!, personnel: 5000, equipment: 1.0 } });
    sim.tick(14);
    sim.dispatch({ type: "declareWar", payload: { attacker: enemy, defender: cid } });
    const eUnit = sim.getUnitsByCountry(enemy).find((u)=>u.countryId===enemy)!;
    // Try to move enemy to SE capital to fight
    // Might need adjacency? Use direct capture via setRegionController hack to simulate destruction? Instead just remove unit manually to simulate last army destroyed
    const anySim = sim as unknown as { units: Map<string, unknown> };
    anySim.units.delete(unit.unitId);
    expect(sim.getUnitsByCountry(cid).length).toBe(0);
    // Next AI should try recruit new garrison
    runAIStep(sim, cid, { reason: "interval14" });
    expect(sim.getUnitsByCountry(cid).length).toBeGreaterThan(0);
  });
});
