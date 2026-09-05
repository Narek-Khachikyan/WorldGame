/**
 * War and peace A — pure logic for WB-A T6 (part of #1, closes #7).
 * Juridical owner (ownerId) changes ONLY by peace (annexOccupied).
 * Occupation = controller change, not owner (contract with army.ts).
 * Exhaustion = days + losses + occupation. AI pure function.
 * Threat rises on aggression (exposed for T8).
 * No alliances in A — no auto-drag (explicit obligation rule).
 */

import warRulesRaw from "../rules/war.json";
import { calculateBaseStrength } from "./army.js";
import type { ArmyUnit, RegionState } from "./army.js";

export const WAR_RULES = warRulesRaw as typeof import("../rules/war.json");

export type PeaceType = "white" | "annexOccupied" | "indemnity";

export interface War {
  warId: string;
  attackerId: string;
  defenderId: string;
  startDay: number;
  startDate: string;
  status: "active" | "ended";
  endDay?: number;
  endDate?: string;
  endReason?: PeaceType;
  exhaustionAttacker: number;
  exhaustionDefender: number;
  casualtiesAttacker: number;
  casualtiesDefender: number;
}

export interface PeaceProposal {
  warId: string;
  proposerId: string;
  type: PeaceType;
}

export interface WarView {
  warId: string;
  attackerId: string;
  defenderId: string;
  startDay: number;
  startDate: string;
  status: "active" | "ended";
  endDay?: number;
  endDate?: string;
  endReason?: PeaceType;
  exhaustionAttacker: number;
  exhaustionDefender: number;
  daysAtWar: number;
  occupiedByAttacker: string[];
  occupiedByDefender: string[];
}

/** Visible cost / consequences of declaring war */
export interface DeclareWarForecast {
  ok: boolean;
  reason: string;
  cost: { treasury: number; threatDelta: number };
  consequences: string[];
  unavailableReason: string | null;
}

export function forecastDeclareWar(
  attackerId: string,
  defenderId: string,
  existingWars: ReadonlyMap<string, War> | War[],
  knownCountryIds: Set<string> | string[]
): DeclareWarForecast {
  const known = knownCountryIds instanceof Set ? knownCountryIds : new Set(knownCountryIds);
  const wars = Array.isArray(existingWars) ? existingWars : Array.from(existingWars.values());
  const cost = { treasury: WAR_RULES.declareWar.treasuryCost, threatDelta: WAR_RULES.declareWar.threatIncrease };
  const consequences = [
    `угроза ${attackerId} +${WAR_RULES.threat.aggressionIncrease} (воспринимаемая угроза для ИИ)`,
    `истощение начнёт расти +${WAR_RULES.exhaustion.perDay}/день, +${WAR_RULES.exhaustion.perOccupiedRegion} за регион`,
    `юрвладелец меняется только миром (оккупация ≠ аннексия)`,
    `союзов нет (A) — автовтягивания в чужие наступательные войны нет`,
  ];
  if (attackerId === defenderId) {
    return { ok: false, reason: WAR_RULES.messages.selfWar, cost, consequences, unavailableReason: WAR_RULES.messages.selfWar };
  }
  if (!known.has(attackerId) || !known.has(defenderId)) {
    const r = `${WAR_RULES.messages.unknownCountry}: ${!known.has(attackerId) ? attackerId : defenderId}`;
    return { ok: false, reason: r, cost, consequences, unavailableReason: r };
  }
  const already = wars.some(
    (w) =>
      w.status === "active" &&
      ((w.attackerId === attackerId && w.defenderId === defenderId) || (w.attackerId === defenderId && w.defenderId === attackerId))
  );
  if (already) {
    const r = `${WAR_RULES.messages.alreadyAtWar}: ${attackerId} ↔ ${defenderId}`;
    return { ok: false, reason: r, cost, consequences, unavailableReason: r };
  }
  return {
    ok: true,
    reason: `война ${attackerId} → ${defenderId}: цена казна ${cost.treasury}, угроза +${cost.threatDelta}. ${consequences.join("; ")}`,
    cost,
    consequences,
    unavailableReason: null,
  };
}

/** Occupied regions for a war: who occupies whose originally-owned land */
export function getOccupiedForWar(
  war: Pick<War, "attackerId" | "defenderId">,
  regionStates: Map<string, RegionState> | RegionState[]
): { occupiedByAttacker: string[]; occupiedByDefender: string[] } {
  const states = regionStates instanceof Map ? Array.from(regionStates.values()) : regionStates;
  const byAtt: string[] = [];
  const byDef: string[] = [];
  for (const rs of states) {
    if (rs.ownerId === war.defenderId && rs.controllerId === war.attackerId) byAtt.push(rs.regionId);
    else if (rs.ownerId === war.attackerId && rs.controllerId === war.defenderId) byDef.push(rs.regionId);
  }
  return { occupiedByAttacker: byAtt.sort(), occupiedByDefender: byDef.sort() };
}

export function computeForceRatio(ownStrength: number, enemyStrength: number): number {
  if (enemyStrength === 0 && ownStrength === 0) return 1;
  if (enemyStrength === 0) return Infinity;
  if (ownStrength === 0) return 0;
  return ownStrength / enemyStrength;
}

export function totalStrength(units: Pick<ArmyUnit, "personnel" | "equipment" | "readiness">[]): number {
  let sum = 0;
  for (const u of units) sum += calculateBaseStrength(u);
  return sum;
}

export function computeExhaustion(
  daysAtWar: number,
  casualties: number,
  occupiedCount: number,
  lostCount: number
): number {
  const perDay = WAR_RULES.exhaustion.perDay;
  const perCas = WAR_RULES.exhaustion.perCasualtyPer1000;
  const perOcc = WAR_RULES.exhaustion.perOccupiedRegion;
  const perLost = WAR_RULES.exhaustion.perLostRegion;
  const raw = daysAtWar * perDay + (casualties / 1000) * perCas + occupiedCount * perOcc + lostCount * perLost;
  const cap = WAR_RULES.exhaustion.max;
  const v = Math.max(0, Math.min(cap, raw));
  return Math.round(v * 10) / 10;
}

/** Pure AI decision — does responder accept proponer's peace offer? */
export function evaluatePeaceAI(params: {
  war: War;
  proposerId: string;
  responderId: string;
  peaceType: PeaceType;
  forceRatioResponder: number;
  exhaustionResponder: number;
  exhaustionProposer: number;
  occupiedByProposer: number;
  occupiedByResponder: number;
  daysAtWar: number;
}): { accept: boolean; reasons: string[]; scoreAccept: number; debug: Record<string, unknown> } {
  const { peaceType, forceRatioResponder, exhaustionResponder, occupiedByProposer, occupiedByResponder, daysAtWar } = params;
  const thr = WAR_RULES.ai.forceRatioThreshold;
  const exhHigh = WAR_RULES.ai.exhaustionHigh;
  const occThr = WAR_RULES.ai.occupationThreshold;
  const daysThr = WAR_RULES.ai.daysThreshold;

  const losingByForce = forceRatioResponder < thr;
  const winningByForce = forceRatioResponder > 1 / thr; // >1.428
  const highExhaustion = exhaustionResponder >= exhHigh;
  const lowExhaustion = exhaustionResponder < 20;
  const losingOccupation = occupiedByProposer >= occThr;
  const winningOccupation = occupiedByResponder >= occThr;
  const longWar = daysAtWar >= daysThr;

  // score for acceptance (higher = more inclined to accept)
  let scoreAccept = 0;
  if (losingByForce) scoreAccept += 3;
  if (highExhaustion) scoreAccept += 2;
  if (losingOccupation) scoreAccept += 3;
  if (longWar && (losingByForce || highExhaustion)) scoreAccept += 1;
  if (winningByForce) scoreAccept -= 2;
  if (winningOccupation) scoreAccept -= 1;
  if (lowExhaustion && !losingByForce && !losingOccupation) scoreAccept -= 1;

  // peace-type adjustments: annex is harsh for loser — needs stronger losing signals; indemnity also harsh but slightly easier than annex
  let threshold = 3;
  if (peaceType === "white") threshold = 2;
  else if (peaceType === "indemnity") threshold = 3;
  else if (peaceType === "annexOccupied") threshold = 4;

  // if annex and no land actually occupied by proposer, then annex is trivial (no effect) — lower threshold to white level
  if (peaceType === "annexOccupied" && occupiedByProposer === 0) threshold = 2;

  const accept = scoreAccept >= threshold;

  // Build reasons: weight decides top-2
  type R = { text: string; weight: number };
  const candidates: R[] = [];
  if (losingByForce) candidates.push({ text: `соотношение сил ${forceRatioResponder.toFixed(2)} — вы проигрываете (порог ${thr})`, weight: 5 });
  else if (winningByForce) candidates.push({ text: `соотношение сил ${forceRatioResponder.toFixed(2)} — вы выигрываете`, weight: 5 });
  else candidates.push({ text: `соотношение сил ${forceRatioResponder.toFixed(2)} — равновесие`, weight: 2 });

  if (highExhaustion) candidates.push({ text: `истощение ${exhaustionResponder.toFixed(0)} — высокое (≥${exhHigh})`, weight: 4 });
  else if (lowExhaustion) candidates.push({ text: `истощение ${exhaustionResponder.toFixed(0)} — низкое`, weight: 2 });
  else candidates.push({ text: `истощение ${exhaustionResponder.toFixed(0)} — умеренное`, weight: 2 });

  if (losingOccupation) candidates.push({ text: `потеряно ${occupiedByProposer} регионов (оккупировано противником)`, weight: 5 });
  else if (winningOccupation) candidates.push({ text: `оккупировано ${occupiedByResponder} вражеских регионов — вы наступаете`, weight: 4 });
  else candidates.push({ text: `территорий не потеряно`, weight: 1 });

  if (longWar) candidates.push({ text: `война длится ${daysAtWar} дн. (≥${daysThr})`, weight: 2 });
  else candidates.push({ text: `война длится ${daysAtWar} дн.`, weight: 1 });

  // peace-type specific reason
  if (peaceType === "annexOccupied" && occupiedByProposer > 0) {
    candidates.push({ text: `аннексия коснётся ${occupiedByProposer} регионов`, weight: 3 });
  } else if (peaceType === "indemnity") {
    candidates.push({ text: `контрибуция ${WAR_RULES.peace.indemnityAmount}₥`, weight: 2 });
  } else if (peaceType === "annexOccupied" && occupiedByProposer === 0) {
    candidates.push({ text: `аннексия — нечего аннексировать (статус-кво)`, weight: 1 });
  }

  candidates.sort((a, b) => b.weight - a.weight);
  const reasons = candidates.slice(0, 2).map((c) => c.text);

  return {
    accept,
    reasons,
    scoreAccept,
    debug: { losingByForce, highExhaustion, losingOccupation, winningByForce, winningOccupation, longWar, threshold },
  };
}

export function getWarDays(war: War, currentDay: number): number {
  if (war.status === "ended" && war.endDay !== undefined) return Math.max(0, war.endDay - war.startDay);
  return Math.max(0, currentDay - war.startDay);
}

/** For UI forecast of peace */
export function forecastPeace(
  war: War,
  proposerId: string,
  type: PeaceType,
  forceRatioResponder: number,
  exhaustionResponder: number,
  occupiedByProposer: number,
  occupiedByResponder: number,
  daysAtWar: number
): { available: boolean; unavailableReason: string | null; aiPreview: { accept: boolean; reasons: string[] } } {
  const valid: PeaceType[] = ["white", "annexOccupied", "indemnity"];
  if (!valid.includes(type)) {
    return { available: false, unavailableReason: `${WAR_RULES.messages.unknownPeaceType}: ${type}`, aiPreview: { accept: false, reasons: [`неизвестный тип ${type}`] } };
  }
  if (war.status !== "active") {
    return { available: false, unavailableReason: WAR_RULES.messages.warNotActive, aiPreview: { accept: false, reasons: [WAR_RULES.messages.warNotActive] } };
  }
  if (proposerId !== war.attackerId && proposerId !== war.defenderId) {
    return { available: false, unavailableReason: WAR_RULES.messages.notParticipant, aiPreview: { accept: false, reasons: [WAR_RULES.messages.notParticipant] } };
  }
  const responderId = proposerId === war.attackerId ? war.defenderId : war.attackerId;
  const evalRes = evaluatePeaceAI({
    war,
    proposerId,
    responderId,
    peaceType: type,
    forceRatioResponder,
    exhaustionResponder,
    exhaustionProposer: 0,
    occupiedByProposer,
    occupiedByResponder,
    daysAtWar,
  });
  // available is always true for type if war active and participant; AI preview tells if they would accept.
  // For annex with no occupied, we still allow but warn via reasons.
  return { available: true, unavailableReason: null, aiPreview: { accept: evalRes.accept, reasons: evalRes.reasons } };
}
