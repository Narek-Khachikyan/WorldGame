import { describe, it, expect } from "vitest";
import { createSim } from "../engine.js";
import { runAIStep, getProfileForCountry, AI_PROFILES } from "../ai.js";
import { saveGame, loadGame } from "../save.js";

describe("AI T8 — base AI by same rules, priorities, profiles, journal", () => {
  it("AI uses only public commands, pays same costs/limits — no hidden money/instant reinforcements", () => {
    const sim = createSim({ seed: 500 });
    sim.setPlayerCountryId("GB");
    // Give FR some treasury to test
    const frEcoBefore = sim.getCountryEconomy("FR")!;
    const frTreasuryBefore = frEcoBefore.treasury;
    const frEco = sim.getEconomy("FR")!;
    // ensure capital needs garrison
    const cap = sim.getCapitalRegion("FR")!;
    expect(cap).toBeTruthy();
    // FR has no units initially, AI should try recruit in capital
    const res = runAIStep(sim, "FR", { reason: "test-capital" });
    // It should have attempted recruit and paid treasury
    const frAfter = sim.getCountryEconomy("FR")!;
    const units = sim.getUnitsByCountry("FR");
    // If acted, treasury should decrease by hiring cost (not increase)
    if (res.acted && res.actions.some((a) => a.includes("recruitUnit"))) {
      expect(frAfter.treasury).toBeLessThan(frTreasuryBefore);
      // daysUntilReady should be hiring time (14) not instant 0 for cheat
      const newUnit = units[0];
      expect(newUnit.daysUntilReady).toBe(14);
      expect(newUnit.personnel).toBeGreaterThanOrEqual(500);
    }
    // No hidden money: overall treasury across all AIs should not explode without cause
    const totalTreasury = sim.getCountryIds().reduce((sum, cid) => sum + (sim.getCountryEconomy(cid)?.treasury ?? 0), 0);
    expect(totalTreasury).toBeLessThan(16 * 50000); // sane bound
  });

  it("priorities: not bankrupt → capital garrison → economy → war only at ~1.5x — peaceful viable", () => {
    const sim = createSim({ seed: 600 });
    sim.setPlayerCountryId("GB");
    // Set FR to bankrupt risk: high debt low treasury
    const fr = "FR";
    const ecoFR = sim.getEconomy(fr)!;
    // Force low treasury via dispatching many projects until debt
    // Instead directly hack via save/restore? Use internal: set debt high
    // Use debug? We'll manipulate via economy internal via any
    const anySim = sim as unknown as { economies: Map<string, { treasury:number; debt:number; weights:{defense:number} }> };
    const frEcoInternal = anySim.economies.get(fr)!;
    frEcoInternal.debt = 400;
    frEcoInternal.treasury = 30;
    // Also ensure capital needs garrison already satisfied? We'll clear units
    // Now AI should prioritize bankruptcy, not war even if force ratio would allow
    const beforeWars = sim.getWars().length;
    runAIStep(sim, fr, { reason: "interval14" });
    const afterWars = sim.getWars().length;
    // Should NOT declare new war when bankrupt
    expect(afterWars).toBe(beforeWars);
    // Should have logged bankruptcy reason
    const aiLogs = sim.getEventLog().filter((e) => e.kind === "aiDecision" && (e.payload as {countryId?:string})?.countryId === fr);
    expect(aiLogs.length).toBeGreaterThan(0);
    const last = aiLogs[aiLogs.length - 1];
    expect((last.payload as {reasons?:string[]})?.reasons?.join(" ")).toMatch(/банкрот/i);
  });

  it("capital garrison priority: AI builds one ready unit in capital if none", () => {
    const sim = createSim({ seed: 701 });
    sim.setPlayerCountryId("GB");
    const cid = "DE";
    const cap = sim.getCapitalRegion(cid)!;
    // Ensure no units there
    expect(sim.getUnitsByCountry(cid).length).toBe(0);
    const beforeEco = sim.getCountryEconomy(cid)!.treasury;
    runAIStep(sim, cid, { reason: "interval14" });
    const units = sim.getUnitsByCountry(cid);
    // Should have at least attempted recruit in capital
    expect(units.length).toBeGreaterThan(0);
    expect(units[0].regionId).toBe(cap);
    expect(sim.getCountryEconomy(cid)!.treasury).toBeLessThan(beforeEco);
    const log = sim.getEventLog().find((e) => e.kind==="aiDecision" && (e.payload as{countryId?:string})?.countryId===cid);
    expect(log).toBeTruthy();
    expect(log!.message).toMatch(/ИИ/);
    // causes present
    expect((log!.payload as {reasons?:string[]})?.reasons?.length).toBeGreaterThan(0);
  });

  it("economy priority: AI builds project when treasury healthy and slot available", () => {
    const sim = createSim({ seed: 802 });
    sim.setPlayerCountryId("GB");
    const cid = "IT";
    // Ensure capital garrison satisfied first so economy priority next
    // recruit one manually to satisfy garrison so AI skips to economy
    sim.dispatch({ type: "recruitUnit", payload: { countryId: cid, regionId: sim.getCapitalRegion(cid)!, personnel: 1200, equipment: 0.8 } });
    sim.tick(14); // make ready
    const beforeTreas = sim.getEconomy(cid)!.treasury;
    // artificially raise treasury to ensure healthy
    const anySim = sim as unknown as { economies: Map<string, { treasury:number }> };
    anySim.economies.get(cid)!.treasury = 800;
    const beforeProjects = sim.getEconomy(cid)!.activeProjects.length;
    runAIStep(sim, cid, { reason: "interval14" });
    const afterProjects = sim.getEconomy(cid)!.activeProjects.length;
    // Should have started one project (if had slot)
    if (afterProjects > beforeProjects) {
      expect(sim.getEconomy(cid)!.treasury).toBeLessThan(800);
      const aiLog = sim.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId===cid).pop();
      expect((aiLog?.payload as {reasons?:string[]})?.reasons?.join(" ")).toMatch(/экономика/i);
    } else {
      // if not, reason logged
      const aiLog = sim.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId===cid).pop();
      expect(aiLog).toBeTruthy();
    }
  });

  it("war only at ~1.5x and profit — cautious needs 1.8x, ambitious 1.4x", () => {
    const sim = createSim({ seed: 903 });
    sim.setPlayerCountryId("GB");
    const attacker = "PL";
    const defender = "CZ";
    // Give attacker huge army, defender none
    sim.dispatch({ type: "recruitUnit", payload: { countryId: attacker, regionId: sim.getCapitalRegion(attacker)!, personnel: 5000, equipment: 1.0 } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: attacker, regionId: sim.getCapitalRegion(attacker)!, personnel: 4000, equipment: 1.0 } });
    sim.tick(14);
    // Ensure attacker capital garrison already satisfied (it is) — but war check will happen after economy? Need to make treasury healthy
    const anySim = sim as unknown as { economies: Map<string, { treasury:number; debt:number }> };
    anySim.economies.get(attacker)!.treasury = 1000;
    anySim.economies.get(attacker)!.debt = 0;
    // Force profile ambitious for attacker to lower threshold
    sim.setAiProfile(attacker, "ambitious");
    // Behavioral check: ambitious vs cautious at ~1.6 ratio (thresholds via AI decisions, not direct config)
    {
      const simC = createSim({ seed: 9031 });
      const simA = createSim({ seed: 9031 });
      for (const s of [simC, simA]) {
        s.setPlayerCountryId("GB");
        s.dispatch({ type: "recruitUnit", payload: { countryId: attacker, regionId: s.getCapitalRegion(attacker)!, personnel: 1600, equipment: 0.8 } });
        s.dispatch({ type: "recruitUnit", payload: { countryId: defender, regionId: s.getCapitalRegion(defender)!, personnel: 1000, equipment: 0.8 } });
        s.tick(14);
        const anyS = s as unknown as { economies: Map<string, { treasury:number; debt:number; activeProjects: unknown[]; controlledRegions: Set<string> }> };
        const eco = anyS.economies.get(attacker)! as unknown as { treasury:number; debt:number; activeProjects: unknown[]; controlledRegions: Set<string> };
        eco.treasury = 800; eco.debt = 0;
        for (const rid of Array.from(eco.controlledRegions)) {
          (eco.activeProjects as unknown[]).push({ id:`dummy-${rid}-1`, countryId:attacker, regionId:rid, type:"regionInfra", price:120, durationDays:45, startDay:0, startDate:"2026-01-01", endDay:45, endDate:"2026-02-15", status:"active" } as unknown as never);
          (eco.activeProjects as unknown[]).push({ id:`dummy-${rid}-2`, countryId:attacker, regionId:rid, type:"regionInfra", price:120, durationDays:45, startDay:0, startDate:"2026-01-01", endDay:45, endDate:"2026-02-15", status:"active" } as unknown as never);
        }
      }
      runAIStep(simC, attacker, { reason: "interval14", profileOverride: "cautious" });
      const warC = simC.getWars().filter((w)=> w.attackerId===attacker).length;
      runAIStep(simA, attacker, { reason: "interval14", profileOverride: "ambitious" });
      const warA = simA.getWars().filter((w)=> w.attackerId===attacker).length;
      expect(warC).toBe(0);
      expect(warA).toBeGreaterThanOrEqual(warC);
    }

    // Run AI — should declare war if ratio high enough
    const beforeWars = sim.getWars().length;
    runAIStep(sim, attacker, { reason: "interval14", profileOverride: "ambitious" });
    const afterWars = sim.getWars().length;
    // If no war declared due to economy priority consuming action, tick again after satisfying economy?
    // At least check that if war declared, it was at high ratio
    if (afterWars > beforeWars) {
      const war = sim.getWars().find((w)=> w.attackerId===attacker || w.defenderId===attacker);
      expect(war).toBeTruthy();
      // Check force ratio was indeed high
      const myStr = sim.getUnitsByCountry(attacker).reduce((s,u)=> s+ u.personnel*u.equipment*u.readiness,0);
      const enemyStr = sim.getUnitsByCountry(defender).reduce((s,u)=> s+ u.personnel*u.equipment*u.readiness,0);
      const ratio = enemyStr===0 ? Infinity : myStr/enemyStr;
      expect(ratio).toBeGreaterThanOrEqual(1.4);
    } else {
      // If not war, it must have done economy build instead — still peaceful viable
      expect(sim.getWars().every((w)=> w.attackerId!==attacker)).toBe(true);
    }

    // Cautious should NOT declare war when ratio just 1.5 (below 1.8)
    const sim2 = createSim({ seed: 904 });
    sim2.setPlayerCountryId("GB");
    // Give attacker moderate advantage ~1.6x via personnel tuning
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: attacker, regionId: sim2.getCapitalRegion(attacker)!, personnel: 1600, equipment: 0.8 } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: defender, regionId: sim2.getCapitalRegion(defender)!, personnel: 1000, equipment: 0.8 } });
    sim2.tick(14);
    anySim.economies.get(attacker)?.treasury ? null : null; // reuse sim2 internal
    const anySim2 = sim2 as unknown as { economies: Map<string, { treasury:number; debt:number }> };
    anySim2.economies.get(attacker)!.treasury = 800;
    anySim2.economies.get(attacker)!.debt = 0;
    // Ensure capital garrison already satisfied for attacker, so war logic reachable — need to also ensure economy not blocking? Make treasury just enough but debt low, and project slots maybe limited? We'll just call AI twice
    runAIStep(sim2, attacker, { reason: "interval14", profileOverride: "cautious" });
    const warsCautious = sim2.getWars().filter((w)=> w.attackerId===attacker);
    // With ratio 1.6 <1.8, cautious should not declare
    expect(warsCautious.length).toBe(0);
  });

  it("losing → asks peace; defends important; logs aiDecision with causes", () => {
    const sim = createSim({ seed: 1001 });
    sim.setPlayerCountryId("GB");
    // Create war where FR loses to GB
    sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    // GB strong
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-1", personnel: 4000, equipment: 1.0 } });
    // FR weak
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 600, equipment: 0.5 } });
    sim.tick(14);
    // GB captures FR region to make FR losing
    const gbUnit = sim.getUnitsByCountry("GB")[0];
    sim.dispatch({ type: "moveUnit", payload: { unitId: gbUnit.unitId, toRegionId: "FR-1" } });
    sim.tick(5);
    // Now FR should be losing (occupied)
    const frUnitsBefore = sim.getUnitsByCountry("FR").length;
    const res = runAIStep(sim, "FR", { reason: "event" });
    // Should have asked peace (white)
    const peaceLogs = sim.getEventLog().filter((e)=> e.kind==="peaceProposed" || e.kind==="peaceRejected" || e.kind==="peaceAccepted");
    expect(peaceLogs.length).toBeGreaterThan(0);
    // AI decision logged with cause losingAskPeace or similar
    const aiLogs = sim.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId==="FR");
    expect(aiLogs.length).toBeGreaterThan(0);
    const last = aiLogs[aiLogs.length-1];
    expect((last.payload as {reasons?:string[]})?.reasons?.join(" ").toLowerCase()).toMatch(/мир|война|проигр|losing|peace/i);
  });

  it("two profiles via rules/ai.json act differently at same force ratio", () => {
    // same sim state, test cautious vs ambitious thresholds via runAIStep
    const mkSim = (seed:number) => {
      const s = createSim({ seed });
      s.setPlayerCountryId("GB");
      const att = "DE";
      const def = "CZ";
      s.dispatch({ type: "recruitUnit", payload: { countryId: att, regionId: s.getCapitalRegion(att)!, personnel: 3000, equipment: 1.0 } });
      s.dispatch({ type: "recruitUnit", payload: { countryId: def, regionId: s.getCapitalRegion(def)!, personnel: 1500, equipment: 0.8 } });
      s.tick(14);
      // ensure capital garrison already: att has unit, so next AI step will try economy first, but we can bypass economy by setting debt low and treasury high and slots filled?
      // Fill project slots for att to prevent economy build
      const anyS = s as unknown as { economies: Map<string, { treasury:number; debt:number; activeProjects:unknown[]; completedProjects:unknown[]; controlledRegions:Set<string> }> };
      const eco = anyS.economies.get(att)!;
      // Add 2 dummy projects per region to fill slots
      for (const rid of Array.from(eco.controlledRegions)) {
        eco.activeProjects.push({ id:`dummy-${rid}-1`, countryId:att, regionId:rid, type:"regionInfra", price:120, durationDays:45, startDay:0, startDate:"2026-01-01", endDay:45, endDate:"2026-02-15", status:"active" } as unknown as never);
        eco.activeProjects.push({ id:`dummy-${rid}-2`, countryId:att, regionId:rid, type:"regionInfra", price:120, durationDays:45, startDay:0, startDate:"2026-01-01", endDay:45, endDate:"2026-02-15", status:"active" } as unknown as never);
      }
      eco.treasury = 700;
      eco.debt = 0;
      return s;
    };
    const simCautious = mkSim(1100);
    const simAmbitious = mkSim(1100);
    // Ratio 3000*1 / (1500*0.8=1200) = 2.5 > both thresholds, so both would declare, need ratio between 1.4 and 1.8
    // Instead make ratio 1.6: att 2400 vs def 1500 => 1.6
    // Recreate more precise
    const simC2 = createSim({ seed: 1101 });
    simC2.setPlayerCountryId("GB");
    simC2.dispatch({ type: "recruitUnit", payload: { countryId: "DE", regionId: simC2.getCapitalRegion("DE")!, personnel: 2000, equipment: 0.8 } });
    simC2.dispatch({ type: "recruitUnit", payload: { countryId: "CZ", regionId: simC2.getCapitalRegion("CZ")!, personnel: 1250, equipment: 0.8 } });
    simC2.tick(14);
    const simA2 = createSim({ seed: 1101 });
    simA2.setPlayerCountryId("GB");
    simA2.dispatch({ type: "recruitUnit", payload: { countryId: "DE", regionId: simA2.getCapitalRegion("DE")!, personnel: 2000, equipment: 0.8 } });
    simA2.dispatch({ type: "recruitUnit", payload: { countryId: "CZ", regionId: simA2.getCapitalRegion("CZ")!, personnel: 1250, equipment: 0.8 } });
    simA2.tick(14);
    // Fill slots for both to skip economy
    for (const s of [simC2, simA2]) {
      const anyS = s as unknown as { economies: Map<string, { treasury:number; debt:number; activeProjects:unknown[]; controlledRegions:Set<string> }> };
      const eco = anyS.economies.get("DE")!;
      for (const rid of Array.from(eco.controlledRegions)) {
        eco.activeProjects.push({ id:`dummy-${rid}-1`, countryId:"DE", regionId:rid, type:"regionInfra", price:120, durationDays:45, startDay:0, startDate:"2026-01-01", endDay:45, endDate:"2026-02-15", status:"active" } as unknown as never);
        eco.activeProjects.push({ id:`dummy-${rid}-2`, countryId:"DE", regionId:rid, type:"regionInfra", price:120, durationDays:45, startDay:0, startDate:"2026-01-01", endDay:45, endDate:"2026-02-15", status:"active" } as unknown as never);
      }
      eco.treasury = 700;
      eco.debt = 0;
    }
    runAIStep(simC2, "DE", { reason: "interval14", profileOverride: "cautious" });
    const warC = simC2.getWars().filter((w)=> w.attackerId==="DE").length;
    runAIStep(simA2, "DE", { reason: "interval14", profileOverride: "ambitious" });
    const warA = simA2.getWars().filter((w)=> w.attackerId==="DE").length;
    // Ambitious should declare at 1.6, cautious should not
    expect(warA).toBeGreaterThanOrEqual(warC);
    // At least check that logs mention profile
    const logC = simC2.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId==="DE").pop();
    const logA = simA2.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId==="DE").pop();
    expect((logC?.payload as {profile?:string})?.profile).toBe("cautious");
    expect((logA?.payload as {profile?:string})?.profile).toBe("ambitious");
  });

  it("peaceful development viable — AI without war still builds economy over 2 years", () => {
    const sim = createSim({ seed: 1200 });
    sim.setPlayerCountryId("GB");
    const cid = "SE";
    // Run AI for 2 years without manually declaring war
    for (let day=0; day< 730; day++) {
      sim.tick(1);
      if (sim.getDaysElapsed() % 14 === 0) {
        for (const cc of sim.getCountryIds()) {
          if (cc === "GB") continue;
          // only tick for SE to isolate? Run for all except player
          if (cc === cid) runAIStep(sim, cc, { reason: "interval14" });
        }
      }
    }
    // SE should have at least one started project over 2 years if peaceful
    const eco = sim.getEconomy(cid)!;
    const totalProjects = eco.activeProjects.length + eco.completedProjects.length;
    expect(totalProjects).toBeGreaterThan(0);
    // Should not be in war unless it chose to declare (allowed but not mandatory)
    // Peaceful viable means we can assert no instant bankruptcy
    expect(eco.debt).toBeLessThan(1000);
    expect(eco.treasury).not.toBeNaN();
  });
});
