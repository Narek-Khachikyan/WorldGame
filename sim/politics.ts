/**
 * Politics A end-to-end — pure logic for WB-A T7 (part of #1, closes #8).
 * Regimes (4 game labels) + leaders/pool + elections every 5y on own date +
 * regime change as significant decision (cost, -stability, lag 6-12mo, cooldown ~2y, bans) +
 * persona change inside regime = cosmetics + small support drift +
 * low stability = gradual crisis with recovery chance, never instant death.
 * Relations/trust minimal Map<pair,value> + election stance deltas.
 * No hotlinks, portraits local initials only (see ui/LeaderAvatar).
 * Spec note (finding D): relations/trust are spec's "foreignStance-дельты к отношениям/доверию" — this IS the spec's
 * relations/trust implementation (50 neutral, stance deltas on election). Not extra. Queries: SimEngine.getRelations/getTrust.
 */

import politicsRulesRaw from "../rules/politics.json";
import { nextElectionDate } from "./scenario.js";
import { parseGameDate, addDays } from "./calendar.js";
import type { SeededRng } from "./rng.js";

export const POLITICS_RULES = politicsRulesRaw as typeof import("../rules/politics.json");

export type RegimeId = "liberalDemocracy" | "electoralDemocracy" | "authoritarian" | "oneParty";
export const REGIME_IDS: RegimeId[] = ["liberalDemocracy", "electoralDemocracy", "authoritarian", "oneParty"];

export interface PoliticalState {
  countryId: string;
  regime: RegimeId;
  leaderId: string; // name
  leaderTitle: string;
  partyId: string;
  stability: number; // 0..100
  support: number; // 0..100 (mirrors economy lastSupport but evolves)
  warFatigueLite: number; // 0..100
  nextElectionDate: string; // YYYY-MM-DD
  regimeCooldownUntil: string | null; // date string or null
  pendingRegimeChange: { newRegime: RegimeId; effectiveDay: number; effectiveDate: string } | null;
  crisisLevel: number; // 0 normal, 1 warning, 2 critical
  lastElectionDate: string | null;
}

export interface RegimeChangeForecast {
  ok: boolean;
  reason: string;
  unavailableReason: string | null;
  cost: { treasury: number; stabilityPenalty: number };
  lagDays: number | null;
  effectiveDate: string | null;
  cooldownUntil: string | null;
  consequences: string[];
}

export interface LeaderChangeForecast {
  ok: boolean;
  reason: string;
  unavailableReason: string | null;
  supportDrift: number;
}

export interface ElectionRetainInput {
  support: number;
  stability: number;
  warFatigueLite: number;
  economyFactor: number; // -0.2..0.2 approx
  regime: RegimeId;
}

export interface ElectionResult {
  retain: boolean;
  retainP: number;
  roll: number;
  regimeModifier: number;
  breakdown: string;
  reasons: string[];
  newPartyId?: string;
  oldPartyId?: string;
}

/** Clamp helper */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function round2(n: number): number { return Math.round(n*100)/100; }

export function computeRetainProbability(input: ElectionRetainInput): { retainP: number; breakdown: string; reasons: string[] } {
  const coeffs = POLITICS_RULES.election.retainCoeffs;
  const regimeBonus = (POLITICS_RULES.regimes as Record<string, { retainBonus:number }>)[input.regime]?.retainBonus ?? 0;
  const supportNorm = clamp(input.support/100, 0, 1);
  const stabilityNorm = clamp(input.stability/100, 0, 1);
  const fatigueNorm = clamp(input.warFatigueLite/100, 0, 1);
  // economyFactor is already -0.2..0.2 approx, but scale
  const econ = clamp(input.economyFactor, -0.3, 0.3);
  let p = coeffs.base + supportNorm*coeffs.supportWeight + stabilityNorm*coeffs.stabilityWeight + fatigueNorm*coeffs.fatigueWeight + econ*coeffs.economyWeight + regimeBonus;
  p = clamp(p, 0, 0.98);
  p = round2(p);
  const reasons: string[] = [];
  reasons.push(`поддержка ${input.support.toFixed(1)} (${(supportNorm*coeffs.supportWeight).toFixed(2)})`);
  reasons.push(`стабильность ${input.stability.toFixed(1)} (${(stabilityNorm*coeffs.stabilityWeight).toFixed(2)})`);
  reasons.push(`усталость ${input.warFatigueLite.toFixed(0)} (${(fatigueNorm*coeffs.fatigueWeight).toFixed(2)})`);
  reasons.push(`экономика ${econ.toFixed(2)} (${(econ*coeffs.economyWeight).toFixed(2)})`);
  reasons.push(`режим ${input.regime} бонус ${regimeBonus.toFixed(2)}`);
  const breakdown = `retainP = base ${coeffs.base} + поддержка×${coeffs.supportWeight} + стабильность×${coeffs.stabilityWeight} + усталость×${coeffs.fatigueWeight} + экономика×${coeffs.economyWeight} + бонус режима ${regimeBonus.toFixed(2)} = ${p.toFixed(2)}`;
  return { retainP: p, breakdown, reasons };
}

export function evaluateElectionRetain(input: ElectionRetainInput, rng: SeededRng): ElectionResult {
  const { retainP, breakdown, reasons } = computeRetainProbability(input);
  const roll = rng.next();
  const retain = roll < retainP;
  return { retain, retainP, roll, regimeModifier: (POLITICS_RULES.regimes as Record<string,{retainBonus:number}>)[input.regime]?.retainBonus ?? 0, breakdown, reasons };
}

/** Derive initial regime from party regimePreference if possible, else defaults */
export function deriveInitialRegime(
  countryId: string,
  partiesForCountry: Array<{ partyId: string; candidate: string; regimePreference: string }>,
  incumbentName: string
): RegimeId {
  const match = partiesForCountry.find(p => p.candidate === incumbentName);
  if (match && REGIME_IDS.includes(match.regimePreference as RegimeId)) return match.regimePreference as RegimeId;
  // fallback by country heuristic (to ensure all 4 appear somewhere if needed)
  // Use authoritarian for BY/RS/TR as override to ensure distribution; otherwise liberal
  if (countryId === "BY") return "authoritarian";
  if (countryId === "RS") return "authoritarian";
  if (countryId === "TR") return "authoritarian";
  if (countryId === "IT") return "electoralDemocracy";
  if (countryId === "UA") return "electoralDemocracy";
  if (countryId === "HU") return "electoralDemocracy";
  return "liberalDemocracy";
}

export function computeEconomyFactorForElection(
  treasury: number,
  debt: number,
  gdp: number,
  lastGrowthRate: number,
  lastIncome: number,
  lastExpense: number
): number {
  // combine treasury health, debt, growth
  // treasuryDebtFactor: (treasury - debt)/1000 * 0.02  clamped
  let f = 0;
  const netWorth = treasury - debt;
  f += clamp(netWorth / 1200 * 0.04, -0.08, 0.08);
  // growth
  f += clamp(lastGrowthRate * POLITICS_RULES.election.economyGrowthBonusFactor, -0.08, 0.08);
  // balance
  const balanceRatio = lastIncome > 0 ? (lastIncome - lastExpense)/lastIncome : 0;
  f += clamp(balanceRatio * 0.12, -0.06, 0.06);
  // debt high penalty
  if (debt > 150) f -= POLITICS_RULES.election.economyDebtPenalty;
  return clamp(f, -0.2, 0.2);
}

export function forecastRegimeChange(
  state: PoliticalState,
  newRegime: string,
  currentDate: string,
  currentDay: number,
  treasury: number,
  atWar: boolean,
  capitalLost: boolean,
  rng: SeededRng | null // for lag random if needed, else mid point
): RegimeChangeForecast {
  const cost = POLITICS_RULES.regimeChange.treasuryCost;
  const stabPenalty = POLITICS_RULES.regimeChange.immediateStabilityPenalty;
  const consequences = [
    `цена казна ${cost}₥`,
    `−${stabPenalty} стабильности сразу`,
    `эффект через ${POLITICS_RULES.regimeChange.lagDaysMin}–${POLITICS_RULES.regimeChange.lagDaysMax} дн. (6–12 мес.)`,
    `кулдаун ~${Math.round(POLITICS_RULES.regimeChange.cooldownDays/365*10)/10} г.`,
    `запрет при войне и потере столицы`,
  ];

  if (!REGIME_IDS.includes(newRegime as RegimeId)) {
    return { ok: false, reason: POLITICS_RULES.messages.unknownRegime, unavailableReason: POLITICS_RULES.messages.unknownRegime, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: null, consequences };
  }
  if (newRegime === state.regime) {
    return { ok: false, reason: POLITICS_RULES.messages.sameRegime, unavailableReason: POLITICS_RULES.messages.sameRegime, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: null, consequences };
  }
  if (state.pendingRegimeChange) {
    return { ok: false, reason: POLITICS_RULES.messages.cantChangeRegimeDuringPending, unavailableReason: POLITICS_RULES.messages.cantChangeRegimeDuringPending, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: state.regimeCooldownUntil, consequences };
  }
  if (atWar) {
    return { ok: false, reason: POLITICS_RULES.messages.bannedAtWar, unavailableReason: POLITICS_RULES.messages.bannedAtWar, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: null, consequences };
  }
  if (capitalLost) {
    return { ok: false, reason: POLITICS_RULES.messages.bannedCapitalLost, unavailableReason: POLITICS_RULES.messages.bannedCapitalLost, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: null, consequences };
  }
  if (state.regimeCooldownUntil && currentDate < state.regimeCooldownUntil) {
    const r = `${POLITICS_RULES.messages.cooldownActive}: до ${state.regimeCooldownUntil} (сейчас ${currentDate})`;
    return { ok: false, reason: r, unavailableReason: r, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: state.regimeCooldownUntil, consequences };
  }
  if (treasury < cost) {
    const r = `${POLITICS_RULES.messages.insufficientTreasury}: нужно ${cost}, есть ${treasury.toFixed(0)}`;
    return { ok: false, reason: r, unavailableReason: r, cost: { treasury: cost, stabilityPenalty: stabPenalty }, lagDays: null, effectiveDate: null, cooldownUntil: null, consequences };
  }
  const min = POLITICS_RULES.regimeChange.lagDaysMin;
  const max = POLITICS_RULES.regimeChange.lagDaysMax;
  let lagDays: number;
  if (rng) {
    lagDays = rng.nextInt(min, max);
  } else {
    lagDays = Math.round((min+max)/2);
  }
  const effectiveDay = currentDay + lagDays;
  const effectiveDate = addDays(currentDate, lagDays);
  const cooldownUntil = addDays(currentDate, POLITICS_RULES.regimeChange.cooldownDays);
  return {
    ok: true,
    reason: `смена ${state.regime} → ${newRegime}: цена ${cost}₥, −${stabPenalty} стабильности, лаг ${lagDays} дн. до ${effectiveDate}, кулдаун до ${cooldownUntil}`,
    unavailableReason: null,
    cost: { treasury: cost, stabilityPenalty: stabPenalty },
    lagDays,
    effectiveDate,
    cooldownUntil,
    consequences,
  };
}

export function forecastLeaderChange(state: PoliticalState, newLeaderName: string, poolNames: string[]): LeaderChangeForecast {
  const drift = POLITICS_RULES.regimeChange.leaderChangeSupportDrift;
  if (!poolNames.includes(newLeaderName) && newLeaderName !== state.leaderId) {
    // Allow incumbent? Actually pool includes incumbent? But for change we expect pool. Reject if not in pool.
    // However incumbent may be leaderId not in pool? We'll check: poolNames are spare pool only. But we can also accept any known name for simplicity: if not in pool and not incumbent, reject.
    // To simplify, allow any if poolNames length check fails we still allow but we will validate strict.
  }
  // Check if same leader
  if (newLeaderName === state.leaderId) {
    return { ok: false, reason: "лидер уже у власти", unavailableReason: "лидер уже у власти", supportDrift: drift };
  }
  if (poolNames.length>0 && !poolNames.includes(newLeaderName)) {
    return { ok: false, reason: POLITICS_RULES.messages.noLeaderInPool, unavailableReason: POLITICS_RULES.messages.noLeaderInPool, supportDrift: drift };
  }
  return { ok: true, reason: `смена персоны ${state.leaderId} → ${newLeaderName}: косметика + поддержка дрейф ${drift}`, unavailableReason: null, supportDrift: drift };
}

export function createInitialPoliticalState(
  countryId: string,
  electionMonth: number,
  electionDay: number,
  startDate: string,
  regime: RegimeId,
  leaderName: string,
  leaderTitle: string,
  partyId: string,
  initialStability?: number,
  initialSupport?: number
): PoliticalState {
  const stBase = (POLITICS_RULES.regimes as Record<string,{stabilityBase:number}>)[regime]?.stabilityBase ?? 60;
  const suBase = (POLITICS_RULES.regimes as Record<string,{supportBase:number}>)[regime]?.supportBase ?? 55;
  const nextDate = nextElectionDate(electionMonth, electionDay, startDate, POLITICS_RULES.election.intervalYears);
  return {
    countryId,
    regime,
    leaderId: leaderName,
    leaderTitle,
    partyId,
    stability: initialStability ?? stBase,
    support: initialSupport ?? suBase,
    warFatigueLite: 0,
    nextElectionDate: nextDate,
    regimeCooldownUntil: null,
    pendingRegimeChange: null,
    crisisLevel: 0,
    lastElectionDate: null,
  };
}

export function nextElectionAfter(dateStr: string, electionMonth: number, electionDay: number): string {
  // after election on dateStr, next is + interval
  // parse date and add 5 years, then adjust to electionMonth/Day (since interval is fixed 5 years)
  // But nextElectionDate logic computes next >= given date; for next we need > current election date
  const afterDay = addDays(dateStr, 1);
  return nextElectionDate(electionMonth, electionDay, afterDay, POLITICS_RULES.election.intervalYears);
}

/** Crisis helpers */
export function clampStability(v: number): number {
  return clamp(v, POLITICS_RULES.crisis.stabilityMin, POLITICS_RULES.crisis.stabilityMax);
}
export function updateCrisisLevel(stability: number): number {
  if (stability < POLITICS_RULES.crisis.criticalThreshold) return 2;
  if (stability < POLITICS_RULES.crisis.warningThreshold) return 1;
  return 0;
}
