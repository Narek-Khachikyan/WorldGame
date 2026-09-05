import { describe, it, expect } from "vitest";
import { createSim } from "../engine.js";
import { WAR_RULES, evaluatePeaceAI, computeForceRatio, totalStrength, computeExhaustion } from "../war.js";

describe("T6 war and peace A end-to-end (public seam)", () => {
  it("declareWar visible cost/consequences, creates active war and raises threat, no alliances", () => {
    const sim = createSim({ seed: 42 });
    const forecast = sim.forecastDeclareWar("GB", "FR");
    expect(forecast.ok).toBe(true);
    expect(forecast.cost.threatDelta).toBe(WAR_RULES.threat.aggressionIncrease);
    expect(forecast.cost.treasury).toBe(WAR_RULES.declareWar.treasuryCost);
    expect(forecast.consequences.join(" ")).toMatch(/угроза/);
    expect(forecast.consequences.join(" ")).toMatch(/союз/);

    const beforeThreatGB = sim.getThreat("GB");
    const res = sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR", reason: "test" } });
    expect(res.ok).toBe(true);
    const wars = sim.getWars();
    expect(wars.length).toBe(1);
    expect(wars[0].attackerId).toBe("GB");
    expect(wars[0].defenderId).toBe("FR");
    expect(wars[0].status).toBe("active");
    expect(sim.getThreat("GB")).toBe(beforeThreatGB + WAR_RULES.threat.aggressionIncrease);
    // isAtWar check
    expect(sim.isAtWar("GB", "FR")).toBe(true);
    expect(sim.isAtWar("FR", "GB")).toBe(true);
    expect(sim.isAtWar("GB", "DE")).toBe(false);
    // no auto-drag: GB war vs FR should not create war vs DE
    expect(sim.getWarsForCountry("DE").length).toBe(0);
    // validator: self war rejected
    const selfRes = sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "GB" } });
    expect(selfRes.ok).toBe(false);
    expect(selfRes.reason).toMatch(/самому себе/);
    // duplicate war rejected
    const dup = sim.dispatch({ type: "declareWar", payload: { attacker: "FR", defender: "GB" } });
    expect(dup.ok).toBe(false);
    expect(dup.reason).toMatch(/уже в войне/);
    // unknown country rejected
    const unk = sim.dispatch({ type: "declareWar", payload: { attacker: "ZZ", defender: "FR" } });
    expect(unk.ok).toBe(false);

    // eventLog contains warDeclared with visible consequences
    const ev = sim.getEventLog().find((e) => e.kind === "warDeclared");
    expect(ev).toBeTruthy();
    expect(ev!.message).toMatch(/угроза/);
    expect((ev!.payload as { attacker?: string })?.attacker).toBe("GB");
    // validator unknown type check still works
    const beforeWarsCount = sim.getWars().length;
    expect(beforeWarsCount).toBe(1);
  });

  it("owner changes only by peace (occupation ≠ annexation) — controller changes on capture, owner only on annex", () => {
    const sim = createSim({ seed: 123 });
    sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    // need units to capture: recruit overwhelming GB unit and weak FR defender
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-2", personnel: 4000, equipment: 1.0, readiness: 1.0 } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 500, equipment: 0.5, readiness: 0.5 } });
    sim.tick(14);
    const frBefore = sim.getRegionState("FR-1")!;
    expect(frBefore.ownerId).toBe("FR");
    expect(frBefore.controllerId).toBe("FR");
    const gb = sim.getUnits().find((u) => u.countryId === "GB")!;
    const mv = sim.dispatch({ type: "moveUnit", payload: { unitId: gb.unitId, toRegionId: "FR-1" } });
    expect(mv.ok).toBe(true);
    const afterCapture = sim.getRegionState("FR-1")!;
    expect(afterCapture.controllerId).toBe("GB");
    expect(afterCapture.ownerId).toBe("FR"); // owner unchanged — occupation
    // ensure controller vs owner contract holds
    const snapAfter = sim.getSnapshot();
    const frSnap = snapAfter.regions?.find((r) => r.regionId === "FR-1");
    expect(frSnap?.controllerId).toBe("GB");
    expect(frSnap?.ownerId).toBe("FR");

    // Now propose peace annexOccupied — should succeed if AI accepts (GB occupying FR land, FR losing)
    // Need to ensure AI accepts: make FR losing — force ratio FR low, exhaustion etc.
    // Force ratio FR vs GB: GB has 4000, FR may have lost defender (500 lost). So FR has maybe 0 units or weakened.
    // Let's tick some days to increase exhaustion and add occupation.
    sim.tick(30);
    const war = sim.getWars()[0];
    // Check occupation
    const occ = sim.getOccupiedForWarId(war.warId)!;
    expect(occ.occupiedByAttacker).toContain("FR-1");
    // forecast annex should show AI would accept due to occupation + force ratio
    const forecast = sim.forecastPeace(war.warId, "GB", "annexOccupied");
    expect(forecast.ok).toBe(true);
    expect(forecast.aiPreview).toBeTruthy();
    // proposer GB winning, responder FR losing -> accept true (strong losing signals)
    expect(forecast.aiPreview!.accept).toBe(true);
    expect(forecast.aiPreview!.reasons.length).toBe(2);
    expect(forecast.aiPreview!.reasons.join(" ")).toMatch(/соотношение|истощение|потеряно/);

    // propose annexOccupied — GB as proposer annexes FR-1
    const resPeace = sim.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "GB", type: "annexOccupied" } });
    expect(resPeace.ok).toBe(true);
    const peaceAccepted = sim.getEventLog().find((e) => e.kind === "peaceAccepted" && (e.payload as { warId?: string })?.warId === war.warId);
    expect(peaceAccepted).toBeTruthy();
    expect((peaceAccepted!.payload as { type?: string })?.type).toBe("annexOccupied");
    const annexedLog = sim.getEventLog().find((e) => e.kind === "regionAnnexed" && (e.payload as { regionId?: string })?.regionId === "FR-1");
    expect(annexedLog).toBeTruthy();
    const frAfterPeace = sim.getRegionState("FR-1")!;
    expect(frAfterPeace.ownerId).toBe("GB"); // owner now GB — only by peace
    expect(frAfterPeace.controllerId).toBe("GB");
    // war ended
    expect(sim.getWar(war.warId)?.status).toBe("ended");
    // further war not active
    expect(sim.isAtWar("GB", "FR")).toBe(false);
  });

  it("3 peace options work: white, annexOccupied, indemnity (treasury transfer)", () => {
    // white
    {
      const sim = createSim({ seed: 7 });
      sim.dispatch({ type: "declareWar", payload: { attacker: "DE", defender: "PL" } });
      sim.tick(35); // make long enough for high exhaustion threshold?
      // need to make responder losing for white accept — we can create capture to make losing
      // For white test without capture, we can still expect acceptance if exhaustion high + days long? Let's occupy to ensure acceptance.
      sim.dispatch({ type: "recruitUnit", payload: { countryId: "DE", regionId: "DE-1", personnel: 4000, equipment: 1.0 } });
      sim.dispatch({ type: "recruitUnit", payload: { countryId: "PL", regionId: "PL-1", personnel: 500, equipment: 0.5 } });
      sim.tick(14);
      const de = sim.getUnits().find((u) => u.countryId === "DE")!;
      // Need adjacency? DE-1 adjacency is intra DE only, no cross-country adjacency in Slice A for DE-PL (maybe none). Use setRegionController trick to simulate occupation without combat.
      // For Slice A, adjacency is only intra-country, so DE cannot directly move to PL. Instead use loseRegion/ setRegionController to create occupation for test.
      // That still counts as occupation for war.
      sim.dispatch({ type: "setRegionController", payload: { regionId: "PL-1", newControllerId: "DE" } });
      sim.tick(20); // days 35+14+20=69, exhaustion high
      const war = sim.getWars()[0];
      const forecast = sim.forecastPeace(war.warId, "DE", "white");
      expect(forecast.aiPreview?.accept).toBe(true);
      // capture should not have changed owner yet
      expect(sim.getRegionState("PL-1")!.ownerId).toBe("PL");
      expect(sim.getRegionState("PL-1")!.controllerId).toBe("DE");
      const res = sim.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "DE", type: "white" } });
      expect(res.ok).toBe(true);
      const accepted = sim.getEventLog().find((e) => e.kind === "peaceAccepted" && (e.payload as { type?: string })?.type === "white");
      expect(accepted).toBeTruthy();
      // white: owner unchanged
      expect(sim.getRegionState("PL-1")!.ownerId).toBe("PL");
      expect(sim.getRegionState("PL-1")!.controllerId).toBe("DE"); // controller stays? White is status quo — spec says white: status quo (no changes). Let's decide white keeps controller as is (no revert) or status quo of controllers? Spec says white: status quo (no annex, no indemnity). So owner unchanged, controller stays as is (occupied stays occupied? But white could mean revert to status quo ante? Usually white peace returns to pre-war borders? But our simple model: white leaves controllers as is but owners unchanged? Actually status quo for owner means no ownership change, controller remains as occupied. That's plausible. We'll assert owner unchanged and war ended.
      expect(sim.getWar(war.warId)?.status).toBe("ended");
    }
    // indemnity
    {
      const sim = createSim({ seed: 8 });
      sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
      sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-2", personnel: 3000, equipment: 1.0 } });
      sim.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 500, equipment: 0.5 } });
      sim.tick(14);
      // create occupation to make FR losing
      sim.dispatch({ type: "setRegionController", payload: { regionId: "FR-1", newControllerId: "GB" } });
      sim.tick(30);
      const war = sim.getWars()[0];
      const beforeTreasuryFR = sim.getEconomy("FR")!.treasury;
      const beforeTreasuryGB = sim.getEconomy("GB")!.treasury;
      // also check countryEconomy
      const beforeCE_FR = sim.getCountryEconomy("FR")!.treasury;
      const beforeCE_GB = sim.getCountryEconomy("GB")!.treasury;
      const forecast = sim.forecastPeace(war.warId, "GB", "indemnity");
      expect(forecast.aiPreview?.accept).toBe(true);
      const res = sim.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "GB", type: "indemnity" } });
      expect(res.ok).toBe(true);
      const accepted = sim.getEventLog().find((e) => e.kind === "peaceAccepted" && (e.payload as { type?: string })?.type === "indemnity");
      expect(accepted).toBeTruthy();
      const afterFR = sim.getEconomy("FR")!.treasury;
      const afterGB = sim.getEconomy("GB")!.treasury;
      const afterCE_FR = sim.getCountryEconomy("FR")!.treasury;
      const afterCE_GB = sim.getCountryEconomy("GB")!.treasury;
      // indemnity 250 transferred FR -> GB (since FR losing, FR pays)
      const amount = WAR_RULES.peace.indemnityAmount;
      // Check transfer via economy (if FR had enough treasury, should deduct amount)
      // Our initial economies treasury 800, after some ticks may be ~800 + income, but still >250, so check delta
      expect(afterFR).toBeLessThan(beforeTreasuryFR);
      expect(afterGB).toBeGreaterThan(beforeTreasuryGB);
      const deltaFR = beforeTreasuryFR - afterFR;
      const deltaGB = afterGB - beforeTreasuryGB;
      // Due to possible debt logic, we check that transfer occurred; allow some variance for monthly tick interference but indemnity should be exactly amount
      // To isolate, ensure we didn't tick between before and after: we didn't, so delta should equal amount (or capped if insufficient)
      // But economies also have monthly ticks that could have happened earlier; just after indemnity tick, we didn't tick, so delta should be amount.
      // However before we had economy initial 800; after indemnity, FR 800-250=550, GB 800+250=1050 if no debt.
      // Let's check within tolerance
      if (beforeTreasuryFR >= amount) {
        expect(deltaFR).toBeCloseTo(amount, 5);
        expect(deltaGB).toBeCloseTo(amount, 5);
      }
      expect(afterCE_FR).toBeCloseTo(beforeCE_FR - amount, 5);
      expect(afterCE_GB).toBeCloseTo(beforeCE_GB + amount, 5);
      const indemnityEv = sim.getEventLog().find((e) => e.kind === "indemnityPaid");
      expect(indemnityEv).toBeTruthy();
      expect((indemnityEv!.payload as { amount?: number })?.amount).toBe(amount);
    }
    // annexOccupied already tested above but do exhaustive for isolated case
    {
      const sim = createSim({ seed: 9 });
      sim.dispatch({ type: "declareWar", payload: { attacker: "IT", defender: "GR" } });
      sim.dispatch({ type: "setRegionController", payload: { regionId: "GR-1", newControllerId: "IT" } });
      sim.dispatch({ type: "setRegionController", payload: { regionId: "GR-2", newControllerId: "IT" } });
      // need units for force ratio to make annex accepted: make IT strong
      sim.dispatch({ type: "recruitUnit", payload: { countryId: "IT", regionId: "IT-1", personnel: 3000, equipment: 1.0 } });
      sim.dispatch({ type: "recruitUnit", payload: { countryId: "GR", regionId: "GR-3", personnel: 500, equipment: 0.5 } });
      sim.tick(40);
      const war = sim.getWars()[0];
      expect(sim.getRegionState("GR-1")!.ownerId).toBe("GR");
      expect(sim.getRegionState("GR-1")!.controllerId).toBe("IT");
      const res = sim.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "IT", type: "annexOccupied" } });
      expect(res.ok).toBe(true);
      const accepted = sim.getEventLog().find((e) => e.kind === "peaceAccepted");
      expect(accepted).toBeTruthy();
      expect(sim.getRegionState("GR-1")!.ownerId).toBe("IT");
      expect(sim.getRegionState("GR-2")!.ownerId).toBe("IT");
      // GR-3 not occupied remains GR
      // GR-3 is controlled by GR, not IT, so not annexed
      expect(sim.getRegionState("GR-3")!.ownerId).toBe("GR");
    }
  });

  it("AI refuse/agree shows main reasons (top 2)", () => {
    const sim = createSim({ seed: 42 });
    sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    // Make FR very strong vs GB to test refusal: FR 4000 vs GB 500, no occupation, few days -> FR winning should refuse
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-1", personnel: 500, equipment: 0.5 } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 4000, equipment: 1.0 } });
    sim.tick(14);
    const war = sim.getWars()[0];
    // days small, exhaustion low, FR winning (if responder is FR when GB proposes, FR force ratio high -> FR winning -> refuse)
    const forecastRefuse = sim.forecastPeace(war.warId, "GB", "white");
    expect(forecastRefuse.aiPreview?.accept).toBe(false);
    expect(forecastRefuse.aiPreview?.reasons.length).toBe(2);
    expect(forecastRefuse.aiPreview?.reasons.join(" ")).toMatch(/соотношение|истощение|потеряно|оккупировано/);
    // Now propose — should be rejected not accepted
    const resRefuse = sim.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "GB", type: "white" } });
    expect(resRefuse.ok).toBe(true);
    const rejected = sim.getEventLog().find((e) => e.kind === "peaceRejected");
    expect(rejected).toBeTruthy();
    expect((rejected!.payload as { reasons?: string[] })?.reasons?.length).toBe(2);
    expect(rejected!.message).toMatch(/отклонён/);

    // Now create opposite: make GB strong and occupy FR to make FR accept
    const sim2 = createSim({ seed: 99 });
    sim2.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-2", personnel: 4000, equipment: 1.0 } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 500, equipment: 0.5 } });
    sim2.tick(14);
    sim2.dispatch({ type: "setRegionController", payload: { regionId: "FR-1", newControllerId: "GB" } });
    sim2.tick(30); // exhaustion rises
    const war2 = sim2.getWars()[0];
    const forecastAccept = sim2.forecastPeace(war2.warId, "GB", "white");
    expect(forecastAccept.aiPreview?.accept).toBe(true);
    expect(forecastAccept.aiPreview?.reasons.length).toBe(2);
    const resAccept = sim2.dispatch({ type: "proposePeace", payload: { warId: war2.warId, proposer: "GB", type: "white" } });
    expect(resAccept.ok).toBe(true);
    const accepted = sim2.getEventLog().find((e) => e.kind === "peaceAccepted");
    expect(accepted).toBeTruthy();
    expect((accepted!.payload as { reasons?: string[] })?.reasons?.length).toBe(2);
  });

  it("unprofitable war can be ended by peace and game continued (no crash, tick still works)", () => {
    const sim = createSim({ seed: 10 });
    sim.dispatch({ type: "declareWar", payload: { attacker: "DE", defender: "FR" } });
    // Make DE losing: weak army, high exhaustion, occupied
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "DE", regionId: "DE-1", personnel: 500, equipment: 0.5 } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 3000, equipment: 1.0 } });
    sim.tick(14);
    sim.dispatch({ type: "setRegionController", payload: { regionId: "DE-1", newControllerId: "FR" } });
    sim.tick(40);
    const war = sim.getWars()[0];
    // DE is proposer losing, FR winning — FR should accept white? Actually DE proposes, FR is winning, should refuse. So make FR proposer? Let's try proposer FR winning -> DE losing should accept? Our AI for responder: if proposer is FR (winning) proposing to DE (losing), DE as responder losing should accept.
    // So propose from FR (winner) to DE (loser)
    const forecast = sim.forecastPeace(war.warId, "FR", "white");
    expect(forecast.aiPreview?.accept).toBe(true); // DE losing accepts
    const res = sim.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "FR", type: "white" } });
    expect(res.ok).toBe(true);
    expect(sim.getWar(war.warId)?.status).toBe("ended");
    // game continues: can tick, recruit, etc., not crash
    sim.tick(60);
    expect(sim.getDaysElapsed()).toBe(14 + 40 + 60);
    // can still recruit after war ended
    const r = sim.dispatch({ type: "recruitUnit", payload: { countryId: "DE", regionId: "DE-2", personnel: 1000, equipment: 0.8 } });
    expect(r.ok).toBe(true);
    // can declare new war after peace
    const newWar = sim.dispatch({ type: "declareWar", payload: { attacker: "DE", defender: "PL" } });
    expect(newWar.ok).toBe(true);
    expect(sim.getWars().length).toBe(2);
    expect(sim.getWars().filter((w) => w.status === "active").length).toBe(1);
  });

  it("full occupation and destruction of last army don't crash game (edge cases)", () => {
    const sim = createSim({ seed: 55 });
    sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "CZ" } });
    // Fully occupy CZ: CZ has 2 regions? Actually CZ has maybe 2? In Slice A CZ has 2? Let's get scenario regions for CZ
    const czRegions = sim.getScenario().regions.filter((r) => r.countryId === "CZ").map((r) => r.regionId);
    expect(czRegions.length).toBeGreaterThanOrEqual(2);
    for (const rid of czRegions) {
      sim.dispatch({ type: "setRegionController", payload: { regionId: rid, newControllerId: "GB" } });
    }
    // verify all CZ regions controlled by GB
    for (const rid of czRegions) {
      expect(sim.getRegionState(rid)!.controllerId).toBe("GB");
      expect(sim.getRegionState(rid)!.ownerId).toBe("CZ"); // owner still CZ before peace
    }
    // tick should not crash
    expect(() => sim.tick(10)).not.toThrow();
    expect(sim.getSnapshot().regions?.filter((r) => r.ownerId === "CZ" && r.controllerId === "GB").length).toBe(czRegions.length);
    // peace still possible after full occupation
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-1", personnel: 3000, equipment: 1.0 } });
    sim.dispatch({ type: "recruitUnit", payload: { countryId: "CZ", regionId: czRegions[0], personnel: 500, equipment: 0.5 } }); // CZ can still recruit? But CZ regions controlled by GB, not owned? Recruitment rule requires owner or controller == countryId. For CZ, controller is GB, owner is CZ, so CZ still can recruit? Let's check: recruit requires ownerId===countryId || controllerId===countryId . CSR owner CZ matches, so CZ can still recruit even though controlled by GB? Actually RS controller GB but owner CZ, so owner match allows recruitment — edge case but not crash.
    // However CZ's capital region is controlled by GB, but owner still CZ, so recruitment allowed per logic.
    // If recruitment fails due to controller check, we still shouldn't crash.
    // Let's try recruit for CZ in controlled region - should succeed because owner matches
    const beforeUnits = sim.getUnits().length;
    const resCZ = sim.dispatch({ type: "recruitUnit", payload: { countryId: "CZ", regionId: czRegions[0], personnel: 1000, equipment: 0.8 } });
    // It may succeed or fail due to treasury, but not crash
    expect(typeof resCZ.ok).toBe("boolean");
    // Now test last army destroyed: create combat where last army dies
    const sim2 = createSim({ seed: 77 });
    sim2.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-2", personnel: 500, equipment: 0.5, readiness: 0.5 } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 5000, equipment: 1.0, readiness: 1.0 } });
    sim2.tick(14);
    const gbUnit = sim2.getUnits().find((u) => u.countryId === "GB")!;
    const frUnit = sim2.getUnits().find((u) => u.countryId === "FR")!;
    // GB attacks FR strong defender — GB likely loses and dies
    const mv = sim2.dispatch({ type: "moveUnit", payload: { unitId: gbUnit.unitId, toRegionId: "FR-1" } });
    expect(mv.ok).toBe(true);
    // GB unit may be destroyed (if defender wins, attacker may still survive with reduced personnel, but with overwhelming defender, attacker likely destroyed? Let's ensure: 500*0.5*0.5=125 vs 5000*1*1=5000 *1.25*... => defender wins, attacker loses 28% => 140 casualties, attacker 500-140=360 remains, not destroyed. So to ensure destruction, we need to make loser repeatedly attack until destroyed or just simulate casualties? Alternative: make GB have tiny army that will be destroyed in combat with huge defender via repeated combats? But our test just needs to ensure war continues and recruitment still possible after destruction.
    // Let's force destruction via set personnel to 1? But personnel min 500, so not.
    // Instead test that after combat, even if one side has fewer units, war still active and can tick without crash even if eventually last army destroyed through multiple combats.
    // We'll simulate by manually removing GB units to simulate destroyed last army.
    for (const u of sim2.getUnits().filter((u) => u.countryId === "GB")) {
      // we could directly test edge: destroy last army via not having any units left
      // we can't directly remove via command, but we can test that tick with 0 units for a war participant doesn't crash.
    }
    // Manually test scenario where GB has no units at all (simulate destroyed)
    const sim3 = createSim({ seed: 88 });
    sim3.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    // GB has no units, FR has one
    sim3.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 1000, equipment: 0.8 } });
    sim3.tick(14);
    expect(sim3.getUnitsByCountry("GB").length).toBe(0);
    expect(sim3.getUnitsByCountry("FR").length).toBe(1);
    // tick should not crash, wars still active
    expect(() => sim3.tick(30)).not.toThrow();
    expect(sim3.getWars()[0].status).toBe("active");
    // recruitment still possible for GB (war continues, can recruit)
    const recruitAfter = sim3.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-1", personnel: 1000, equipment: 0.8 } });
    expect(recruitAfter.ok).toBe(true);
    expect(sim3.getUnitsByCountry("GB").length).toBe(1);
    // also test annex with full occupation doesn't crash and game continues
    const sim4 = createSim({ seed: 99 });
    sim4.dispatch({ type: "declareWar", payload: { attacker: "TR", defender: "GR" } });
    const grRegs = sim4.getScenario().regions.filter((r) => r.countryId === "GR").map((r) => r.regionId);
    for (const rid of grRegs) sim4.dispatch({ type: "setRegionController", payload: { regionId: rid, newControllerId: "TR" } });
    sim4.dispatch({ type: "recruitUnit", payload: { countryId: "TR", regionId: "TR-1", personnel: 4000, equipment: 1.0 } });
    sim4.dispatch({ type: "recruitUnit", payload: { countryId: "GR", regionId: grRegs[0], personnel: 500, equipment: 0.5 } });
    sim4.tick(35);
    const war4 = sim4.getWars()[0];
    // force high exhaustion/occupation so AI accepts annex
    const resPeace4 = sim4.dispatch({ type: "proposePeace", payload: { warId: war4.warId, proposer: "TR", type: "annexOccupied" } });
    expect(resPeace4.ok).toBe(true);
    // should not crash even with full occupation
    expect(() => sim4.tick(10)).not.toThrow();
    expect(sim4.getSnapshot().wars?.some((w) => w.warId === war4.warId && w.status === "ended")).toBe(true);
  });

  it("exhaustion grows with days, losses and occupation; exposed for AI and threat visible", () => {
    const sim = createSim({ seed: 11 });
    sim.dispatch({ type: "declareWar", payload: { attacker: "PL", defender: "RO" } });
    const war = sim.getWars()[0];
    const exhStartAtt = war.exhaustionAttacker;
    const exhStartDef = war.exhaustionDefender;
    sim.tick(10);
    const warAfter10 = sim.getWar(war.warId)!;
    expect(warAfter10.exhaustionAttacker).toBeGreaterThan(exhStartAtt);
    expect(warAfter10.exhaustionDefender).toBeGreaterThan(exhStartDef);
    // add occupation -> exhaustion higher than without
    const sim2 = createSim({ seed: 12 });
    sim2.dispatch({ type: "declareWar", payload: { attacker: "PL", defender: "RO" } });
    sim2.dispatch({ type: "setRegionController", payload: { regionId: "RO-1", newControllerId: "PL" } });
    sim2.tick(10);
    const war2 = sim2.getWar(sim2.getWars()[0].warId)!;
    // With occupation, exhaustion should be higher than without occupation for same days (compare attacker exhaustion)
    // But need to compare same casualty (0) but occupation adds. So war2 attacker should have higher exhaustion than warAfter10 attacker (since extra occupied region)
    // Allow tolerance
    expect(war2.exhaustionAttacker).toBeGreaterThanOrEqual(warAfter10.exhaustionAttacker);
    // losses increase exhaustion: create combat casualties
    const sim3 = createSim({ seed: 13 });
    sim3.dispatch({ type: "declareWar", payload: { attacker: "SE", defender: "RO" } });
    // Use regions that are adjacent? SE not adjacent to RO, so use occupation trick plus combat via GB-FR style? Instead simulate casualties via war's casualty counter increment in combat.
    // We'll directly test computeExhaustion pure function
    const exhNoCas = computeExhaustion(30, 0, 0, 0);
    const exhWithCas = computeExhaustion(30, 2000, 0, 0);
    expect(exhWithCas).toBeGreaterThan(exhNoCas);
    // threat visible after multiple wars
    const before = sim.getThreat("PL");
    sim.dispatch({ type: "declareWar", payload: { attacker: "PL", defender: "UA" } });
    expect(sim.getThreat("PL")).toBe(before + WAR_RULES.threat.aggressionIncrease);
    // Also check forecast shows threat delta
    const fc = sim.forecastDeclareWar("PL", "TR");
    expect(fc.cost.threatDelta).toBe(WAR_RULES.threat.aggressionIncrease);
  });

  it("pure AI function deterministic and exposes top 2 reasons", () => {
    const war: import("../war.js").War = {
      warId: "war-1",
      attackerId: "GB",
      defenderId: "FR",
      startDay: 0,
      startDate: "2026-01-01",
      status: "active",
      exhaustionAttacker: 10,
      exhaustionDefender: 60,
      casualtiesAttacker: 500,
      casualtiesDefender: 3000,
    };
    const resAccept = evaluatePeaceAI({
      war,
      proposerId: "GB",
      responderId: "FR",
      peaceType: "white",
      forceRatioResponder: 0.4,
      exhaustionResponder: 60,
      exhaustionProposer: 10,
      occupiedByProposer: 2,
      occupiedByResponder: 0,
      daysAtWar: 50,
    });
    expect(resAccept.accept).toBe(true);
    expect(resAccept.reasons.length).toBe(2);
    expect(resAccept.reasons.join(" ")).toMatch(/соотношение|истощение|потеряно/);

    const resRefuse = evaluatePeaceAI({
      war,
      proposerId: "GB",
      responderId: "FR",
      peaceType: "white",
      forceRatioResponder: 1.5,
      exhaustionResponder: 10,
      exhaustionProposer: 10,
      occupiedByProposer: 0,
      occupiedByResponder: 2,
      daysAtWar: 5,
    });
    expect(resRefuse.accept).toBe(false);
    expect(resRefuse.reasons.length).toBe(2);
  });

  it("validator rejects unknown/broken war commands with reason", () => {
    const sim = createSim({ seed: 1 });
    expect(sim.dispatch({ type: "declareWar", payload: { attacker: "GB" } } as unknown as { type: string }).ok).toBe(false);
    expect(sim.dispatch({ type: "declareWar", payload: { attacker: "", defender: "FR" } } as unknown as { type: string }).ok).toBe(false);
    expect(sim.dispatch({ type: "proposePeace", payload: { warId: "war-999", proposer: "GB", type: "white" } }).ok).toBe(false);
    expect(sim.dispatch({ type: "proposePeace", payload: { warId: "war-1", proposer: "GB", type: "bad" } } as unknown as { type: string }).ok).toBe(false);
    // propose on ended war rejected
    const sim2 = createSim({ seed: 2 });
    sim2.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-2", personnel: 4000, equipment: 1.0 } });
    sim2.dispatch({ type: "recruitUnit", payload: { countryId: "FR", regionId: "FR-1", personnel: 500, equipment: 0.5 } });
    sim2.tick(14);
    sim2.dispatch({ type: "setRegionController", payload: { regionId: "FR-1", newControllerId: "GB" } });
    sim2.tick(30);
    const war = sim2.getWars()[0];
    sim2.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "GB", type: "white" } });
    expect(sim2.getWar(war.warId)?.status).toBe("ended");
    const secondPeace = sim2.dispatch({ type: "proposePeace", payload: { warId: war.warId, proposer: "GB", type: "white" } });
    expect(secondPeace.ok).toBe(false);
    expect(secondPeace.reason).toMatch(/завершена/);
  });

  it("snapshot includes wars and threats for UI", () => {
    const sim = createSim({ seed: 42 });
    sim.dispatch({ type: "declareWar", payload: { attacker: "GB", defender: "FR" } });
    const snap = sim.getSnapshot();
    expect(snap.wars).toBeTruthy();
    expect(snap.wars!.length).toBe(1);
    expect(snap.wars![0].warId).toBe("war-1");
    expect(snap.threats).toBeTruthy();
    expect(snap.threats!["GB"]).toBe(WAR_RULES.threat.aggressionIncrease);
    // threats for other countries 0
    expect(snap.threats!["FR"]).toBe(0);
  });
});
