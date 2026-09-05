/**
 * Army A end-to-end — pure logic for WB-A T5 (part of #1, closes #6).
 * Grouping: personnel (composition), equipment (0.5-1.0), readiness (0.5-1.0), supply base, stance.
 * Combat: strength = personnel × equipment × readiness, + defense 1.25 + fortifications + terrain (plains/mountains/city) + supply penalty + RNG ±10% seeded.
 * Capture = controller change, not owner (owner only changed by peace in T6 — contract).
 * Movement validated via adjacency.json or crossings.json; sea without crossing rejected with reason (UK case).
 * Supply detachment beyond N regions (supplyDistanceN=3) — base penalty 0.7 (full network Stage B).
 * Upkeep hook: dailyUpkeepCost(unit) exposed for T4 economy defense weight; standalone tick() deducts from treasury directly.
 */

import armyRulesRaw from "../rules/army.json";
import type { SeededRng } from "./rng.js";

export type Stance = "offensive" | "defensive" | "entrenched";
export const VALID_STANCES = new Set<string>(["offensive", "defensive", "entrenched"]);

const RULES = armyRulesRaw as typeof import("../rules/army.json");

// Re-export rule values for engine/UI queries
export const ARMY_RULES = RULES;

export interface ArmyUnit {
  unitId: string;
  countryId: string;
  regionId: string;
  personnel: number; // composition
  equipment: number; // 0.5-1.0 factor
  readiness: number; // 0.5-1.0
  stance: Stance;
  supplyBase?: string;
  /** Days until unit becomes combat-ready after hiring; 0 = ready */
  daysUntilReady: number;
  /** Total hiring time recorded for UI */
  hiringTimeDays: number;
}

export interface RegionState {
  regionId: string;
  countryId: string; // original country of region (owner's countryCode)
  ownerId: string; // juridical owner — only peace (T6) may change
  controllerId: string; // current controller — changes on capture
  terrain: string; // plains | mountains | city
  fortLevel: number; // 0+ (0 no fort)
  isCapitalRegion: boolean;
}

export interface CombatBreakdown {
  attacker: {
    base: number;
    baseFormula: string;
    supplyPenalty: number;
    randomFactor: number;
    final: number;
  };
  defender: {
    base: number;
    baseFormula: string;
    defenseBonus: number;
    fortBonus: number;
    terrainMultiplier: number;
    terrain: string;
    supplyPenalty: number;
    randomFactor: number;
    final: number;
  };
  winner: "attacker" | "defender";
  reason: string;
}

export interface CombatResult {
  winner: "attacker" | "defender";
  attackerStrength: number;
  defenderStrength: number;
  breakdown: CombatBreakdown;
  attackerCasualties: number;
  defenderCasualties: number;
  captured: boolean;
  newControllerId: string | null;
  randomSeedStateBefore: number | null;
}

// — helpers

export function calculateBaseStrength(unit: Pick<ArmyUnit, "personnel" | "equipment" | "readiness">): number {
  return unit.personnel * unit.equipment * unit.readiness;
}

export function getTerrainMultiplier(terrain: string): number {
  const m = (RULES.combat.terrainMultipliers as Record<string, number>)[terrain];
  if (typeof m === "number") return m;
  // fallback for unknown terrain
  return 1.0;
}

export function getFortificationMultiplier(fortLevel: number): number {
  const per = RULES.combat.fortificationBonusPerLevel;
  return 1 + Math.max(0, fortLevel) * per;
}

export function dailyUpkeepCost(unit: Pick<ArmyUnit, "personnel" | "equipment">): number {
  const perP = RULES.upkeep.costPerPersonnelPerDay;
  const perE = RULES.upkeep.costPerEquipmentPerDay;
  // equipment field is 0.5-1.0 factor; map to stock via hiring rule: equipmentStockPerEquipmentUnit * equipment? But for upkeep we use personnel * equipment * perE proxy.
  // To keep linear: cost = personnel * perP + personnel * equipment * perE
  return unit.personnel * perP + unit.personnel * unit.equipment * perE;
}

export function hiringCost(personnel: number, equipment: number): { treasury: number; population: number; equipmentStock: number } {
  const perP = RULES.hiring.costPerPersonnel;
  const perE = RULES.hiring.costPerEquipment;
  const eqStockPer = RULES.hiring.equipmentStockPerEquipmentUnit;
  return {
    treasury: personnel * perP + equipment * perE * personnel * 0.1,
    population: personnel * RULES.hiring.populationPerPersonnel,
    equipmentStock: Math.round(equipment * eqStockPer),
  };
}

export function validateHiringParams(personnel: number, equipment: number): { ok: boolean; reason?: string } {
  const minP = RULES.hiring.minPersonnel;
  const maxP = RULES.hiring.maxPersonnel;
  if (!Number.isInteger(personnel) || personnel < minP || personnel > maxP) {
    return { ok: false, reason: RULES.messages.invalidPersonnel };
  }
  const eqMin = RULES.hiring.equipmentMin;
  const eqMax = RULES.hiring.equipmentMax;
  if (typeof equipment !== "number" || equipment < eqMin || equipment > eqMax) {
    return { ok: false, reason: RULES.messages.invalidEquipment };
  }
  return { ok: true };
}

/** BFS distance in hops via adjacency + crossings unified graph */
export function bfsDistance(
  fromRegionId: string,
  toRegionId: string,
  adjacency: Record<string, string[]>,
  crossings: Array<{ fromRegionId: string; toRegionId: string }>
): number | null {
  if (fromRegionId === toRegionId) return 0;
  const graph = new Map<string, Set<string>>();
  // build from adjacency
  for (const [k, neigh] of Object.entries(adjacency)) {
    if (!graph.has(k)) graph.set(k, new Set());
    for (const nb of neigh) {
      graph.get(k)!.add(nb);
      if (!graph.has(nb)) graph.set(nb, new Set());
      graph.get(nb)!.add(k);
    }
  }
  // add crossings (undirected)
  for (const c of crossings) {
    if (!graph.has(c.fromRegionId)) graph.set(c.fromRegionId, new Set());
    if (!graph.has(c.toRegionId)) graph.set(c.toRegionId, new Set());
    graph.get(c.fromRegionId)!.add(c.toRegionId);
    graph.get(c.toRegionId)!.add(c.fromRegionId);
  }
  const visited = new Set<string>([fromRegionId]);
  const queue: Array<[string, number]> = [[fromRegionId, 0]];
  while (queue.length > 0) {
    const [cur, dist] = queue.shift()!;
    const neigh = graph.get(cur);
    if (!neigh) continue;
    for (const nb of neigh) {
      if (nb === toRegionId) return dist + 1;
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push([nb, dist + 1]);
      }
    }
  }
  return null; // unreachable
}

export function getSupplyPenalty(
  unitRegionId: string,
  capitalRegionId: string | null,
  adjacency: Record<string, string[]>,
  crossings: Array<{ fromRegionId: string; toRegionId: string }>
): number {
  if (!capitalRegionId) return 1.0;
  const n = RULES.movement.supplyDistanceN;
  const penalty = RULES.movement.supplyPenaltyFactor;
  const dist = bfsDistance(capitalRegionId, unitRegionId, adjacency, crossings);
  if (dist === null) return penalty; // detached completely -> apply penalty
  return dist > n ? penalty : 1.0;
}

/**
 * Validate movement via land adjacency or sea crossing.
 * Returns ok or reason. Sea without crossing is rejected with seaRejection message containing "переправа".
 */
export function canMove(
  fromRegionId: string,
  toRegionId: string,
  adjacency: Record<string, string[]>,
  crossings: Array<{ fromRegionId: string; toRegionId: string }>
): { ok: boolean; reason?: string; via?: "adjacency" | "crossing" } {
  if (fromRegionId === toRegionId) {
    return { ok: false, reason: RULES.messages.sameRegion };
  }
  const neigh = adjacency[fromRegionId] ?? [];
  if (neigh.includes(toRegionId)) {
    return { ok: true, via: "adjacency" };
  }
  const hasCrossing = crossings.some(
    (c) =>
      (c.fromRegionId === fromRegionId && c.toRegionId === toRegionId) ||
      (c.fromRegionId === toRegionId && c.toRegionId === fromRegionId)
  );
  if (hasCrossing) {
    return { ok: true, via: "crossing" };
  }
  // not adjacent and not crossing => sea or unavailable land
  return {
    ok: false,
    reason: `${RULES.messages.seaRejection}: ${fromRegionId} → ${toRegionId} (${RULES.messages.noAdjacency})`,
  };
}

/**
 * Pure combat resolver — seeded RNG ±10%.
 * strength = composition × equipment × readiness
 * defense +25% + fortifications (0.15 per level) + terrain (plains/mountains/city) + supply penalty + RNG ±10%
 * No side-effects; caller applies capture/casualties.
 * Deterministic at same seed (rng state sequence).
 */
export function resolveCombat(
  attacker: ArmyUnit,
  defender: ArmyUnit,
  attackerRegionState: RegionState | null,
  defenderRegionState: RegionState | null,
  adjacency: Record<string, string[]>,
  crossings: Array<{ fromRegionId: string; toRegionId: string }>,
  capitalRegionFor: (countryId: string) => string | null,
  rng: SeededRng
): CombatResult {
  const BASE_FORMULA = "сила = состав × оснащение × готовность";
  const attBase = calculateBaseStrength(attacker);
  const defBase = calculateBaseStrength(defender);

  // supply penalty
  const attCapital = capitalRegionFor(attacker.countryId);
  const defCapital = capitalRegionFor(defender.countryId);
  const attSupplyPenalty = getSupplyPenalty(attacker.regionId, attCapital, adjacency, crossings);
  const defSupplyPenalty = getSupplyPenalty(defender.regionId, defCapital, adjacency, crossings);

  // defense bonuses applied to defender only
  const defenseBonus = RULES.combat.defenseBonus; // 1.25
  const fortBonus = defenderRegionState ? getFortificationMultiplier(defenderRegionState.fortLevel) : 1.0;
  const terrain = defenderRegionState?.terrain ?? "plains";
  const terrainMult = getTerrainMultiplier(terrain);

  // random ±10% on seeded RNG
  const spread = RULES.combat.randomSpread; // 0.1
  const attRand = 1 - spread + rng.next() * spread * 2;
  const defRand = 1 - spread + rng.next() * spread * 2;

  // stance modifiers: entrenched/defensive gives extra defense, offensive gives slight attack? Keep simple: defensive stance additional 1.1, entrenched 1.2
  let stanceDefBonus = 1.0;
  if (defender.stance === "defensive") stanceDefBonus = 1.1;
  else if (defender.stance === "entrenched") stanceDefBonus = 1.2;

  let stanceAttBonus = 1.0;
  if (attacker.stance === "offensive") stanceAttBonus = 1.05;

  const attFinal = attBase * attSupplyPenalty * stanceAttBonus * attRand;
  const defFinal = defBase * defSupplyPenalty * defenseBonus * fortBonus * terrainMult * stanceDefBonus * defRand;

  const attackerWins = attFinal > defFinal;
  const winner: "attacker" | "defender" = attackerWins ? "attacker" : "defender";

  // casualties
  const winRate = RULES.combat.winnerCasualtyRate;
  const loseRate = RULES.combat.loserCasualtyRate;
  let attackerCasualties: number;
  let defenderCasualties: number;
  if (winner === "attacker") {
    attackerCasualties = Math.floor(attacker.personnel * winRate);
    defenderCasualties = Math.floor(defender.personnel * loseRate);
    // scale by strength ratio? if crushing victory, extra casualties for loser
    if (attFinal > defFinal * 1.5) defenderCasualties = Math.floor(defender.personnel * Math.min(0.6, loseRate * 1.5));
  } else {
    defenderCasualties = Math.floor(defender.personnel * winRate);
    attackerCasualties = Math.floor(attacker.personnel * loseRate);
    if (defFinal > attFinal * 1.5) attackerCasualties = Math.floor(attacker.personnel * Math.min(0.6, loseRate * 1.5));
  }
  // at least 1 if personnel >0 and combat occurred
  if (attacker.personnel > 0 && attackerCasualties === 0) attackerCasualties = 1;
  if (defender.personnel > 0 && defenderCasualties === 0) defenderCasualties = 1;

  const captured = winner === "attacker"; // if defender region, capture on attacker win
  const breakdown: CombatBreakdown = {
    attacker: {
      base: attBase,
      baseFormula: BASE_FORMULA,
      supplyPenalty: attSupplyPenalty,
      randomFactor: attRand,
      final: attFinal,
    },
    defender: {
      base: defBase,
      baseFormula: BASE_FORMULA,
      defenseBonus,
      fortBonus,
      terrainMultiplier: terrainMult,
      terrain,
      supplyPenalty: defSupplyPenalty,
      randomFactor: defRand,
      final: defFinal,
    },
    winner,
    reason: `Защита +25% × укрепления × местность (${terrain} ×${terrainMult.toFixed(2)}) × снабжение × случайность ±10% (seeded)`,
  };

  return {
    winner,
    attackerStrength: attFinal,
    defenderStrength: defFinal,
    breakdown,
    attackerCasualties,
    defenderCasualties,
    captured,
    newControllerId: captured ? attacker.countryId : null,
    randomSeedStateBefore: null,
  };
}

/**
 * Explain combat without RNG consumption (for UI preview) — uses mid random 1.0.
 * For deterministic preview, set rngFactor = 1.0.
 */
export function explainCombat(
  attacker: ArmyUnit,
  defender: ArmyUnit,
  defenderRegionState: RegionState | null
): string {
  const attBase = calculateBaseStrength(attacker);
  const defBase = calculateBaseStrength(defender);
  const fort = defenderRegionState ? getFortificationMultiplier(defenderRegionState.fortLevel) : 1.0;
  const terrain = defenderRegionState?.terrain ?? "plains";
  const terrMult = getTerrainMultiplier(terrain);
  return `сила = состав × оснащение × готовность | атака ${attBase.toFixed(0)} vs оборона ${defBase.toFixed(0)} ×1.25(оборона) ×${fort.toFixed(2)}(укрепления) ×${terrMult.toFixed(2)}(${terrain}) × снабжение × случайность ±10% (seeded RNG)`;
}
