/**
 * AI A — базовый ИИ без читов, играет по тем же правилам.
 * Pure TS, использует только публичные команды: setTax/setWeights/startProject/recruitUnit/moveUnit/declareWar/proposePeace.
 * Приоритеты: не обанкротиться → гарнизон столицы → экономика → война только при ~1.5x и выгоде; проигрывая → просит мир; защищает важное.
 * 2 профиля cautious/ambitious via rules/ai.json, стратегия каждые 14 игровых дней + по событиям.
 * Причины решений — в eventLog aiDecision с causes.
 * Хук: runAIStep(sim, countryId, opts) — standalone, вызывается engine tick (каждые 14 дней per country AI-controlled) или UI loop.
 */

import type { SimEngine } from "./engine.js";
import aiRulesRaw from "../rules/ai.json";
import { ECONOMY_RULES } from "./economy.js";
import { ARMY_RULES } from "./army.js";
import { WAR_RULES, totalStrength, computeForceRatio } from "./war.js";

const AI_RULES = aiRulesRaw as typeof import("../rules/ai.json");

export type AiProfileId = "cautious" | "ambitious";

export interface AiProfile {
  id: AiProfileId;
  nameRu: string;
  warForceRatioMin: number;
  warTreasuryMin: number;
  warDebtMax: number;
  warExhaustionMax: number;
  debtTolerance: number;
  treasuryLowThreshold: number;
  economyProjectPreference: string;
  maxWarDeclarationsPerYear: number;
  defendPriority: number;
}

export const AI_PROFILES: Record<AiProfileId, AiProfile> = AI_RULES.profiles as unknown as Record<AiProfileId, AiProfile>;

export const AI_INTERVAL_DAYS: number = AI_RULES.strategyIntervalDays;

function hashCountryToProfile(countryId: string): AiProfileId {
  // deterministic: sum char codes mod 2
  let h = 0;
  for (let i = 0; i < countryId.length; i++) h += countryId.charCodeAt(i);
  // ensure balanced distribution: even -> cautious, odd -> ambitious, but seed also could influence
  // Make at least GB cautious for demo; but hash already will give GB: G(71)+B(66)=137 odd => ambitious. Let's force map for predictability in tests: use alphabetical index
  const order = ["AT","BY","CZ","DE","ES","FR","GB","GR","HU","IT","PL","RO","RS","SE","TR","UA"];
  const idx = order.indexOf(countryId);
  if (idx !== -1) return idx % 2 === 0 ? "cautious" : "ambitious";
  return h % 2 === 0 ? "cautious" : "ambitious";
}

export function getProfileForCountry(countryId: string, overrides?: Record<string, AiProfileId>): AiProfile {
  const id = overrides?.[countryId] ?? hashCountryToProfile(countryId);
  return AI_PROFILES[id] ?? AI_PROFILES.cautious;
}

function getProfileIdForCountry(countryId: string, overrides?: Record<string, AiProfileId>): AiProfileId {
  return (overrides?.[countryId] ?? hashCountryToProfile(countryId));
}

export interface AiDecisionLog {
  countryId: string;
  profile: AiProfileId;
  cause: string;
  actions: string[];
  reasons: string[];
  day: number;
  date: string;
}

function logAIDecision(sim: SimEngine, decision: AiDecisionLog): void {
  // Public seam: engine.appendEvent (no anySim reflective access, fix Mysterious Name)
  sim.appendEvent("aiDecision", decision, `ИИ ${decision.countryId} (${decision.profile}): ${decision.cause} — ${decision.reasons.join("; ")}`);
}

/**
 * Main AI step — pure decisions via public commands.
 * Returns summary for testing.
 */
export function runAIStep(
  sim: SimEngine,
  countryId: string,
  opts?: { reason?: string; profileOverride?: AiProfileId; overridesMap?: Record<string, AiProfileId> }
): { acted: boolean; actions: string[]; reasons: string[]; profile: AiProfileId } {
  const profileId = opts?.profileOverride ?? opts?.overridesMap?.[countryId] ?? getProfileIdForCountry(countryId, opts?.overridesMap);
  const profile = AI_PROFILES[profileId] ?? AI_PROFILES.cautious;
  const snapshot = sim.getSnapshot();
  const date = sim.getDate();
  const day = sim.getDaysElapsed();
  const reasons: string[] = [];
  const actions: string[] = [];
  let acted = false;

  const econ = sim.getEconomy(countryId);
  const politics = sim.getPoliticalState(countryId);
  const units = sim.getUnitsByCountry(countryId);
  const wars = sim.getWarsForCountry(countryId).filter((w) => w.status === "active");
  const isAtWar = wars.length > 0;
  const threat = sim.getThreat(countryId);

  // Helper to dispatch and track
  function tryDispatch(cmd: { type: string; payload?: unknown }): boolean {
    const res = sim.dispatch(cmd as unknown as import("./types.js").Command);
    if (res.ok) {
      actions.push(`${cmd.type} ${JSON.stringify(cmd.payload ?? {})}`);
      acted = true;
      return true;
    } else {
      reasons.push(`отклонено ${cmd.type}: ${res.reason}`);
      return false;
    }
  }

  // 1) Priority: not bankrupt — avoid negative treasury / high debt / high interest
  // Message Chains fix: use engine.getTreasury/getBalance helpers (no sim.getEconomy(cid)!.treasury chains)
  const treasury = (sim as unknown as { getTreasury?: (id:string)=>number|undefined }).getTreasury
    ? (sim as unknown as { getTreasury: (id:string)=>number|undefined }).getTreasury(countryId) ?? 0
    : (econ ? econ.treasury : (sim.getCountryEconomy(countryId)?.treasury ?? 0));
  const debt = (sim as unknown as { getDebt?: (id:string)=>number|undefined }).getDebt
    ? (sim as unknown as { getDebt: (id:string)=>number|undefined }).getDebt(countryId) ?? 0
    : (econ ? econ.debt : 0);
  const lastIncome = econ ? econ.lastIncome : 0;
  const lastExpense = econ ? econ.lastExpense : 0;
  const balance = lastIncome - lastExpense;
  const lastInterest = econ ? econ.lastInterest : 0;

  const isBankruptRisk =
    debt > profile.debtTolerance ||
    treasury < profile.treasuryLowThreshold ||
    (balance < AI_RULES.thresholds.bankruptcy.balanceNegativeThreshold && (treasury < 300 || debt > 100)) ||
    lastInterest > AI_RULES.thresholds.bankruptcy.interestHigh ||
    (econ && econ.debt > AI_RULES.thresholds.bankruptcy.debtHigh && treasury < AI_RULES.thresholds.bankruptcy.treasuryLow);

  if (isBankruptRisk) {
    // Try to stabilize
    reasons.push(`приоритет 1: риск банкротства (казна ${treasury.toFixed(0)}, долг ${debt.toFixed(0)}, баланс ${balance.toFixed(1)}, проценты ${lastInterest.toFixed(1)})`);
    // If at war and losing, ask peace immediately (losing condition below)
    // Else adjust tax/weights toward solvency
    if (isAtWar) {
      // check if losing -> propose peace (handled also in losing priority, but do early)
      const shouldAskPeace = evaluateLosing(sim, countryId, wars);
      if (shouldAskPeace) {
        // try white peace first (least harsh)
        for (const w of wars) {
          const proposer = countryId;
          const forecast = sim.forecastPeace(w.warId, proposer, "white");
          if (forecast.ok) {
            const ok = tryDispatch({ type: "proposePeace", payload: { warId: w.warId, proposer, type: "white" } });
            if (ok) reasons.push(`просит белый мир по ${w.warId} из-за банкротства/потерь`);
            // only one peace per step
            break;
          }
        }
        // if we acted via peace, still also maybe adjust economy but limit actions per step to 1-2
        if (acted) {
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "bankruptcy+war", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
    }

    // Adjust tax upward if not too high, to increase income now (tradeoff growth/support)
    if (econ) {
      const currentTax = econ.taxRate;
      const idealMax = AI_RULES.thresholds.economy.maxTaxRate;
      if (currentTax < idealMax - 1e-9 && currentTax < 0.40) {
        const newTax = Math.min(idealMax, Math.round((currentTax + 0.02) * 100) / 100);
        // ensure step valid
        const ok = tryDispatch({ type: "setTax", payload: { countryId, taxRate: newTax } });
        if (ok) reasons.push(`поднял налог ${ (currentTax*100).toFixed(0)}%→${(newTax*100).toFixed(0)}% для спасения казны`);
        // limit one economic adjust per bankruptcy step
        if (acted) {
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "bankruptcy", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
      // Reduce expense weights: try lower defense, edu, keep social if support low? Simple: reduce defense 0.1 if >0.3
      const curW = econ.weights;
      if (curW.defense > 0.3) {
        const newW = { ...curW, defense: Math.max(0, Math.round((curW.defense - 0.1) * 20) / 20) };
        const ok = tryDispatch({ type: "setWeights", payload: { countryId, weights: newW } });
        if (ok) reasons.push(`снизил оборонный вес ${curW.defense.toFixed(2)}→${newW.defense.toFixed(2)} для экономии`);
        if (acted) {
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "bankruptcy", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
      // If still not acted, try cut edu similarly
      if (curW.edu > 0.25) {
        const newW = { ...curW, edu: Math.max(0, Math.round((curW.edu - 0.1) * 20) / 20) };
        const ok = tryDispatch({ type: "setWeights", payload: { countryId, weights: newW } });
        if (ok) reasons.push(`снизил науку ${curW.edu.toFixed(2)}→${newW.edu.toFixed(2)} для экономии`);
        if (acted) {
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "bankruptcy", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
    }
    // If we reach here without acting, just log bankruptcy watch
    reasons.push("банкротство: удержание, без экстерн действий (нет доступных ходов)");
  }

  // 2) Capital garrison — ensure at least 1 ready unit in capital region
  const capRegion = sim.getCapitalRegion(countryId);
  if (capRegion) {
    const capUnits = units.filter((u) => u.regionId === capRegion && u.daysUntilReady === 0);
    if (capUnits.length < AI_RULES.thresholds.capitalGarrison.minReadyUnits) {
      reasons.push(`приоритет 2: гарнизон столицы ${capRegion} — готово ${capUnits.length}/${AI_RULES.thresholds.capitalGarrison.minReadyUnits}`);
      // Try recruit in capital region
      const economyCountry = sim.getCountryEconomy(countryId);
      const treasuryForHire = economyCountry?.treasury ?? treasury;
      // Simple check: if hiringCost fits
      const prefPers = AI_RULES.thresholds.capitalGarrison.preferredPersonnel;
      const prefEq = AI_RULES.thresholds.capitalGarrison.preferredEquipment;
      // We attempt recruit; if fails due to treasury/population/stock, engine will reject and we log reason
      const ok = tryDispatch({ type: "recruitUnit", payload: { countryId, regionId: capRegion, personnel: prefPers, equipment: prefEq } });
      if (ok) reasons.push(`нанят гарнизон в столице ${capRegion} ${prefPers} чел.`);
      else reasons.push(`не удалось нанять гарнизон в ${capRegion} (казна ${treasuryForHire.toFixed(0)})`);
      // Capital garrison is high priority, if we acted, log and proceed maybe still allow one more economy action? But limit to 1 action per priority to keep stable.
      // We will return after capital garrison attempt if acted, to avoid stacking too many actions per 14 days
      if (acted) {
        logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "capitalGarrison", actions: [...actions], reasons: [...reasons], day, date });
        return { acted, actions, reasons, profile: profileId };
      }
      // if not acted (failed), continue to economy but keep reason
    } else {
      reasons.push(`гарнизон столицы в норме (${capUnits.length} готово)`);
    }
  } else {
    reasons.push(`нет данных столицы для ${countryId}`);
  }

  // 2.5) Losing → ask peace (higher priority than economy) — if at war and losing, try peace before economy
  if (isAtWar) {
    const losing = evaluateLosing(sim, countryId, wars);
    if (losing) {
      reasons.push(`война: проигрывает (losing eval true) — просит мир (приоритет выше экономики)`);
      for (const w of wars) {
        const proposer = countryId;
        const types: Array<"white" | "annexOccupied" | "indemnity"> = ["white", "indemnity", "annexOccupied"];
        let proposed = false;
        for (const tp of types) {
          const forecast = sim.forecastPeace(w.warId, proposer, tp as unknown as import("./war.js").PeaceType);
          if (forecast.ok) {
            const ok = tryDispatch({ type: "proposePeace", payload: { warId: w.warId, proposer, type: tp } });
            if (ok) {
              reasons.push(`просит мир ${tp} по ${w.warId} (проигрывающий)`);
              proposed = true;
              break;
            }
          }
        }
        if (proposed) break;
      }
      if (acted) {
        logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "losingAskPeace", actions: [...actions], reasons: [...reasons], day, date });
        return { acted, actions, reasons, profile: profileId };
      } else {
        reasons.push(`просьба мира отклонена/недоступна (нет войны для мира?)`);
      }
    }
  }

  // 3) Economy — build if treasury healthy, adjust toward ideal tax if not bankrupt
  if (econ) {
    const reserve = AI_RULES.thresholds.economy.treasuryReserveForProject;
    const idealTax = AI_RULES.thresholds.economy.idealTaxRate;
    // If treasury allows and debt tolerable, try start project in first controlled region with slot
    const controlled = Array.from(econ.controlledRegions).sort();
    const treasuryHealthy = treasury > reserve + 100 && debt < AI_RULES.thresholds.economy.debtTolerableForProject;
    if (treasuryHealthy) {
      // choose project type per profile
      const pref = profile.economyProjectPreference as import("./economy.js").ProjectType;
      const types: Array<import("./economy.js").ProjectType> = [pref, "regionInfra", "powerUnit", "industrialComplex"].filter((v, i, a) => a.indexOf(v)===i) as any;
      let started = false;
      for (const regionId of controlled) {
        for (const pt of types) {
          const forecast = sim.forecastProject(countryId, regionId, pt);
          if (!forecast) continue;
          if (!forecast.unavailableReason && treasury >= forecast.cost + reserve * 0.5) {
            const ok = tryDispatch({ type: "startProject", payload: { countryId, regionId, projectType: pt } });
            if (ok) {
              reasons.push(`экономика: запущен ${pt} в ${regionId} цена ${forecast.cost} — казна ${treasury.toFixed(0)} позволяет, приоритет ${profileId}`);
              started = true;
              break;
            } else {
              // if rejected due slot or treasury, continue
            }
          }
        }
        if (started) break;
      }
      if (started) {
        logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "economyBuild", actions: [...actions], reasons: [...reasons], day, date });
        return { acted, actions, reasons, profile: profileId };
      } else {
        reasons.push(`экономика: нет доступного слота/казны для стройки (казна ${treasury.toFixed(0)}, долг ${debt.toFixed(0)})`);
      }
    } else {
      reasons.push(`экономика: казна ${treasury.toFixed(0)} < резерв ${reserve} или долг ${debt.toFixed(0)} — откладывает стройку`);
    }

    // Also if tax far from ideal and not bankrupt risk, drift toward ideal
    const curTax = econ.taxRate;
    if (!isBankruptRisk && Math.abs(curTax - idealTax) > 0.025) {
      const direction = curTax < idealTax ? 1 : -1;
      const newTax = Math.round((curTax + direction * 0.01) * 100) / 100;
      if (newTax >= ECONOMY_RULES.income.tax.min && newTax <= ECONOMY_RULES.income.tax.max) {
        const ok = tryDispatch({ type: "setTax", payload: { countryId, taxRate: newTax } });
        if (ok) reasons.push(`налоги дрейф к идеалу ${idealTax*100}%: ${(curTax*100).toFixed(0)}%→${(newTax*100).toFixed(0)}%`);
        if (acted) {
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "economyTaxDrift", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
    }
  }

  // 3.5) Deals — reassess wars/peace + threat-aware posture (Stage B placeholder, spec A "сделки")
  // Minimal implementation: if threatened (threat>20) or at war, re-evaluate peace and tilt weights to growth.
  // Uses engine.getCountryMilitarySummary (Feature Envy fix) and treasury helpers.
  {
    const military = (sim as unknown as { getCountryMilitarySummary?: (id:string)=>{strength:number; treasury:number} }).getCountryMilitarySummary
      ? (sim as unknown as { getCountryMilitarySummary: (id:string)=>{strength:number; treasury:number} }).getCountryMilitarySummary(countryId)
      : { strength: totalStrength(units), treasury };
    const highThreat = threat > 20;
    const shouldReassessDeals = highThreat || isAtWar;
    if (shouldReassessDeals && econ) {
      // threat-aware economy: tilt weights toward infra/edu growth if threatened, reduce defense
      const curW = econ.weights;
      if (highThreat && curW.defense > 0.3 && !acted) {
        const newW = { ...curW, defense: Math.max(0, Math.round((curW.defense - 0.05) * 20) / 20), infra: Math.min(1, Math.round((curW.infra + 0.05) * 20) / 20) };
        const ok = tryDispatch({ type: "setWeights", payload: { countryId, weights: newW } });
        if (ok) {
          reasons.push(`сделки: угроза ${threat.toFixed(0)} — сдвиг к росту (оборона ${curW.defense.toFixed(2)}→${newW.defense.toFixed(2)}, инфра ${curW.infra.toFixed(2)}→${newW.infra.toFixed(2)})`);
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "deals", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
      // re-evaluate peace for any active war (even if not strictly losing by evaluateLosing, deals reassesses)
      if (isAtWar && !acted) {
        for (const w of wars) {
          const proposer = countryId;
          const forecast = sim.forecastPeace(w.warId, proposer, "white");
          if (forecast.ok && forecast.aiPreview?.accept) {
            const ok = tryDispatch({ type: "proposePeace", payload: { warId: w.warId, proposer, type: "white" } });
            if (ok) {
              reasons.push(`сделки: переоценка мира по ${w.warId} при угрозе ${threat.toFixed(0)} — просит белый мир`);
              logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "deals", actions: [...actions], reasons: [...reasons], day, date });
              return { acted, actions, reasons, profile: profileId };
            }
          }
        }
        if (!acted) reasons.push(`сделки: угроза ${threat.toFixed(0)}, переоценка мира — мир не выгоден/недоступен`);
      } else if (!isAtWar && highThreat && !acted) {
        reasons.push(`сделки: высокая угроза ${threat.toFixed(0)} — приоритет рост/оборона, война откладывается`);
      }
    }
  }

  // 4) Defend important — if capital lost or region lost, try to move units to recapture / defend
  // Simple: if any region owned but not controlled, try to move closest unit toward it if adjacent.
  // For now implement capital recovery priority
  const ownedButNotControlled = (sim.getRegionStates() ?? []).filter((r) => r.ownerId === countryId && r.controllerId !== countryId);
  if (ownedButNotControlled.length > 0) {
    reasons.push(`защита: потеряно ${ownedButNotControlled.length} своих регионов (owner=${countryId} но controller != ${countryId})`);
    // Find a ready unit that can move adjacent to a lost region
    const readyUnits = units.filter((u) => u.daysUntilReady === 0);
    // Try to find unit adjacent via adjacency or crossing
    const adjacency = (sim.getScenario() as any).adjacency as Record<string, string[]>;
    const crossings = (sim.getScenario() as any).crossings as Array<{ fromRegionId: string; toRegionId: string }>;
    let moved = false;
    for (const lost of ownedButNotControlled) {
      for (const u of readyUnits) {
        // canMove check uses sim's validator; we can attempt dispatch directly and check result
        const res = sim.dispatch({ type: "moveUnit", payload: { unitId: u.unitId, toRegionId: lost.regionId } } as any);
        if (res.ok) {
          actions.push(`moveUnit ${u.unitId} ${u.regionId}→${lost.regionId} (возврат своей земли)`);
          acted = true;
          reasons.push(`пытается вернуть ${lost.regionId} из ${lost.controllerId} через бой/ход`);
          moved = true;
          break;
        } else {
          // ignore reason noise, but keep for debug
          // If reason is about not adjacent, try next unit
          if (res.reason && res.reason.includes("переправа")) {
            // not adjacent, skip
          }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (moved) {
      logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "defendLost", actions: [...actions], reasons: [...reasons], day, date });
      return { acted, actions, reasons, profile: profileId };
    } else {
      reasons.push(`защита: нет готового отряда рядом для возврата ${ownedButNotControlled[0].regionId}`);
    }
  }

  // If capital region controller != owner and capital lost, that's critical — already flagged in ownedButNotControlled, but extra reason
  const capLost = sim.isCapitalLost(countryId);
  if (capLost && !acted) {
    reasons.push(`критично: столица ${capRegion} потеряна — приоритет защиты/мира`);
    // Already tried defend; if still not acted, maybe propose peace to reduce pressure?
    // That will be handled in losing branch below
  }

  // 5) War — only if ~1.5x and profit; else if losing → ask peace
  // First, losing check: if at war and losing, ask peace
  if (isAtWar) {
    const losing = evaluateLosing(sim, countryId, wars);
    if (losing) {
      reasons.push(`война: проигрывает (losing eval true) — просит мир`);
      // Prefer white or indemnity depending on exhaustion? Simple: try white first
      for (const w of wars) {
        const proposer = countryId;
        // Choose type: if occupiedByEnemy >0 try white to salvage? Or annex if we occupy? But we are losing, so white is safer to propose
        const types: Array<"white" | "annexOccupied" | "indemnity"> = ["white", "indemnity", "annexOccupied"];
        let proposed = false;
        for (const tp of types) {
          const forecast = sim.forecastPeace(w.warId, proposer, tp as any);
          if (forecast.ok) {
            const ok = tryDispatch({ type: "proposePeace", payload: { warId: w.warId, proposer, type: tp } });
            if (ok) {
              reasons.push(`просит мир ${tp} по ${w.warId} (проигрывающий)`);
              proposed = true;
              break;
            }
          }
        }
        if (proposed) break;
      }
      if (acted) {
        logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "losingAskPeace", actions: [...actions], reasons: [...reasons], day, date });
        return { acted, actions, reasons, profile: profileId };
      } else {
        reasons.push(`просьба мира отклонена/недоступна (нет войны для мира?)`);
      }
    } else {
      reasons.push(`война: воюет, но не проигрывает — удерживает фронт`);
      // If winning, maybe consider annex peace if occupies enemy? But spec says losing → asks peace, not winning asks. So winning just defends; no action needed this tick.
      // However could try to advance: move unit into enemy adjacent empty region to occupy
      // Try to find enemy controlled but owned by enemy, adjacent to our unit
      const enemyIds = wars.map((w) => (w.attackerId === countryId ? w.defenderId : w.attackerId));
      const readyUnits = units.filter((u) => u.daysUntilReady === 0);
      if (readyUnits.length > 0) {
        // Find a region owned by enemy but not at war? Use adjacency to find target
        const allRegions = sim.getRegionStates();
        // Find enemy regions adjacent to any ready unit's region
        const adjacency = (sim.getScenario() as any).adjacency as Record<string, string[]>;
        const crossings = (sim.getScenario() as any).crossings as Array<{ fromRegionId: string; toRegionId: string }>;
        let movedForward = false;
        for (const u of readyUnits) {
          const neigh = adjacency[u.regionId] ?? [];
          const crossNeigh = crossings.filter((c) => c.fromRegionId === u.regionId || c.toRegionId === u.regionId).map((c) => (c.fromRegionId === u.regionId ? c.toRegionId : c.fromRegionId));
          const candidates = [...neigh, ...crossNeigh];
          for (const candId of candidates) {
            const rs = allRegions.find((r) => r.regionId === candId);
            if (!rs) continue;
            if (enemyIds.includes(rs.controllerId) && rs.controllerId !== countryId) {
              // enemy controlled region, try to attack/occupy
              const res = sim.dispatch({ type: "moveUnit", payload: { unitId: u.unitId, toRegionId: candId } } as any);
              if (res.ok) {
                actions.push(`moveUnit ${u.unitId} ${u.regionId}→${candId} (наступление)`);
                acted = true;
                reasons.push(`наступает на ${candId} противника ${rs.controllerId}`);
                movedForward = true;
                break;
              }
            }
          }
          if (movedForward) break;
        }
        if (movedForward) {
          logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "warAdvance", actions: [...actions], reasons: [...reasons], day, date });
          return { acted, actions, reasons, profile: profileId };
        }
      }
    }
  } else {
    // Not at war — evaluate war declaration only if ~1.5x and profit
    // Limit checks: profile thresholds
    if (treasury < profile.warTreasuryMin) {
      reasons.push(`мир: не объявляет войну — казна ${treasury.toFixed(0)} < лимит ${profile.warTreasuryMin} (${profileId})`);
    } else if (debt > profile.warDebtMax) {
      reasons.push(`мир: долг ${debt.toFixed(0)} > лимит ${profile.warDebtMax} (${profileId}) — сдерживается`);
    } else if (sim.getWars().filter((w) => w.status === "active").length > 4) {
      reasons.push(`мир: слишком много войн в мире — откладывает`);
    } else {
      // Choose potential defender: find neighbor country with lowest strength ratio where we have advantage
      const candidates = sim.getCountryIds().filter((cid) => cid !== countryId);
      // Filter not already at war with us (we are not at war currently, but could be at war with others? We are peace now, so all candidates not at war with us)
      // Compute our total strength
      const ourStrength = totalStrength(units);
      if (ourStrength === 0) {
        reasons.push(`мир: нет армии (сила 0) — не нападает`);
      } else {
        // Evaluate each candidate's strength
        const scored: Array<{ cid: string; ratio: number; enemyStrength: number; reasons: string[] }> = [];
        for (const cid of candidates) {
          const enemyUnits = sim.getUnitsByCountry(cid);
          const enemyStrength = totalStrength(enemyUnits);
          const ratio = computeForceRatio(ourStrength, enemyStrength);
          // Also consider economy profit: enemy with higher GDP? For simplicity profit if they have treasury?
          // Use forecast: would we profit? If ratio >= profile threshold, consider candidate
          if (ratio >= profile.warForceRatioMin) {
            // Additional profit check: enemy treasury >0 or controlled regions income bonus? Simple check: we have at least 1.2*profile threshold and enemy debt not huge
            scored.push({ cid, ratio, enemyStrength, reasons: [] });
          }
        }
        scored.sort((a, b) => b.ratio - a.ratio);
        if (scored.length === 0) {
          reasons.push(`мир: нет цели с превосходством ≥${profile.warForceRatioMin}x (наша сила ${ourStrength.toFixed(0)}) — мирное развитие`);
        } else {
          // Pick top candidate but also check exhaustion
          const top = scored[0];
          // Check exhaustion: if we already exhausted or politics war fatigue high, avoid
          const pol = politics;
          const fatigue = pol ? pol.warFatigueLite : 0;
          if (fatigue > profile.warExhaustionMax) {
            reasons.push(`мир: усталость ${fatigue.toFixed(0)} > лимит ${profile.warExhaustionMax} — не нападает несмотря на силу ${top.ratio.toFixed(2)}x vs ${top.cid}`);
          } else {
            // Declare war on top
            const defender = top.cid;
            const forecast = sim.forecastDeclareWar(countryId, defender);
            if (forecast.ok) {
              const ok = tryDispatch({ type: "declareWar", payload: { attacker: countryId, defender, reason: `ИИ ${profileId}: сила ${top.ratio.toFixed(2)}x, казна ${treasury.toFixed(0)}` } });
              if (ok) reasons.push(`объявил войну ${defender} при силе ${top.ratio.toFixed(2)}x (против ${top.enemyStrength.toFixed(0)}), профиль ${profileId}`);
              else reasons.push(`не удалось объявить войну ${defender}: ${forecast.unavailableReason}`);
            } else {
              reasons.push(`прогноз войны ${countryId}→${defender} недоступен: ${forecast.unavailableReason}`);
            }
            if (acted) {
              logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "warDeclare", actions: [...actions], reasons: [...reasons], day, date });
              return { acted, actions, reasons, profile: profileId };
            }
          }
        }
      }
    }
    if (!acted) reasons.push(`итог: мирное развитие — война не выгодна/не достигнута 1.5x`);
  }

  // If nothing acted, still log decision for visibility
  if (!acted) {
    reasons.push(`бездействие: стабильные условия, мирное развитие жизнеспособно (профиль ${profileId}, угроза ${threat.toFixed(0)})`);
  }
  logAIDecision(sim, { countryId, profile: profileId, cause: opts?.reason ?? "strategy", actions: [...actions], reasons: [...reasons], day, date });
  return { acted, actions, reasons, profile: profileId };
}

function evaluateLosing(sim: SimEngine, countryId: string, wars: ReturnType<SimEngine["getWarsForCountry"]>): boolean {
  // Use same AI thresholds as war.ts: forceRatio <0.7 or exhaustion >=45 or occupied >=1
  // But per country, check each war
  const units = sim.getUnitsByCountry(countryId);
  const ourStrength = totalStrength(units);
  for (const w of wars) {
    const isAttacker = w.attackerId === countryId;
    const enemyId = isAttacker ? w.defenderId : w.attackerId;
    const enemyUnits = sim.getUnitsByCountry(enemyId);
    const enemyStrength = totalStrength(enemyUnits);
    const ratio = computeForceRatio(ourStrength, enemyStrength);
    const exhaustion = isAttacker ? w.exhaustionAttacker : w.exhaustionDefender;
    const occ = sim.getOccupiedForWarId(w.warId);
    const occupiedByEnemy = isAttacker ? (occ?.occupiedByDefender.length ?? 0) : (occ?.occupiedByAttacker.length ?? 0);
    const days = w.status === "active" ? sim.getDaysElapsed() - w.startDay : 0;
    // AI losing criteria
    const forceLosing = ratio < WAR_RULES.ai.forceRatioThreshold; // 0.7
    const exhHigh = exhaustion >= WAR_RULES.ai.exhaustionHigh; // 45
    const occLosing = occupiedByEnemy >= WAR_RULES.ai.occupationThreshold; // 1
    const longWar = days >= WAR_RULES.ai.daysThreshold; // 30
    // Score similar to peace AI: need at least 2 strong signals or one critical
    let losingScore = 0;
    if (forceLosing) losingScore += 3;
    if (exhHigh) losingScore += 2;
    if (occLosing) losingScore += 3;
    if (longWar && (forceLosing || exhHigh)) losingScore += 1;
    if (losingScore >= 3) return true;
    // Also consider capital lost
    if (sim.isCapitalLost(countryId)) return true;
  }
  return false;
}

/**
 * Run AI for all non-player countries if interval elapsed or event triggered.
 * Returns summary per country.
 */
export function runAIStrategyForAll(
  sim: SimEngine,
  opts?: { playerCountryId?: string | null; forceReason?: string; overrides?: Record<string, AiProfileId> }
): Record<string, { acted: boolean; actions: string[]; reasons: string[]; profile: AiProfileId }> {
  const player = opts?.playerCountryId ?? null;
  const all = sim.getCountryIds();
  const out: Record<string, ReturnType<typeof runAIStep>> = {};
  for (const cid of all) {
    if (cid === player) continue;
    // Check interval: if not forced, only act every 14 days
    // We use global daysElapsed % interval ==0 or per-country lastRun not tracked here — caller ensures interval.
    out[cid] = runAIStep(sim, cid, { reason: opts?.forceReason ?? "interval14", overridesMap: opts?.overrides });
  }
  return out;
}

/**
 * Helper: should AI act this day? True if daysElapsed % 14 === 0 or event-driven.
 */
export function shouldAIActThisDay(daysElapsed: number, reason?: string): boolean {
  if (reason && reason !== "interval14") return true;
  return daysElapsed % AI_INTERVAL_DAYS === 0;
}
