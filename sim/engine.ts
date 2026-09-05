import { GameCalendar, START_DATE, addDays } from "./calendar.js";
import { SeededRng } from "./rng.js";
import { EventLog } from "./eventLog.js";
import { validateCommand } from "./validator.js";
import type { Command, SimSnapshot, ValidationResult, RegionControllerState, CountryEconomyState, WarSnapshot } from "./types.js";
import { loadScenario } from "./scenario.js";
import type { Scenario } from "./scenario.js";
import {
  ECONOMY_RULES,
  createInitialEconomyForCountry,
  computeMonthlyIncome,
  computeMonthlyExpense,
  computeGrowthRate,
  computeSupport,
  computeBaseExpense,
  forecastProject,
  forecastTaxChange,
  forecastWeightsChange,
  processMonthlyTick,
  validateTaxRate,
  validateWeights,
  type CountryEconomy,
  type ExpenseWeights,
  type ProjectType,
  type EconomyForecast,
} from "./economy.js";
import {
  type ArmyUnit,
  type RegionState,
  type Stance,
  VALID_STANCES,
  bfsDistance,
  calculateBaseStrength,
  canMove,
  dailyUpkeepCost as armyDailyUpkeepCost,
  getSupplyPenalty,
  getTerrainMultiplier,
  getFortificationMultiplier,
  resolveCombat,
  explainCombat,
  hiringCost,
  validateHiringParams,
} from "./army.js";
import armyRulesRaw from "../rules/army.json";
import countriesRaw from "../data/countries.json";
import regionsRaw from "../data/regions.json";
import {
  type War,
  type PeaceType,
  WAR_RULES,
  forecastDeclareWar as forecastDeclareWarPure,
  getOccupiedForWar,
  computeForceRatio,
  totalStrength,
  computeExhaustion,
  evaluatePeaceAI,
  getWarDays,
} from "./war.js";

export const SIM_START_DATE = START_DATE;
export const DEFAULT_SEED = 42;

const ARMY_RULES = armyRulesRaw as typeof import("../rules/army.json");

/**
 * Pure sim core — no React/PixiJS.
 * Public seam: commands + tick(days) + queries + eventLog.
 * Union of T4 economy + T5 army + T6 war.
 */
export class SimEngine {
  readonly seed: number;
  private rng: SeededRng;
  private calendar: GameCalendar;
  private log: EventLog;
  private tickCount = 0;
  private customState: Record<string, number> = {};

  // T4 economy
  private economies: Map<string, CountryEconomy> = new Map();
  private regionController: Map<string, string> = new Map();
  private nextProjectId = 1;

  // T5 army state
  private scenario: Scenario;
  private regionStates: Map<string, RegionState> = new Map();
  private countryEconomy: Map<string, CountryEconomyState> = new Map();
  private units: Map<string, ArmyUnit> = new Map();
  private nextUnitSeq = 1;
  private capitalRegionByCountry: Map<string, string> = new Map();

  // T6 war
  private wars: Map<string, War> = new Map();
  private nextWarId = 1;
  private threat: Map<string, number> = new Map();

  constructor(config?: { seed?: number; startDate?: string }) {
    const seed = config?.seed ?? DEFAULT_SEED;
    this.seed = seed >>> 0;
    this.rng = new SeededRng(this.seed);
    this.calendar = new GameCalendar(config?.startDate ?? START_DATE);
    this.log = new EventLog();
    this.scenario = loadScenario();
    this.initArmyState();
    this.log.append(this.calendar.getDateString(), "simCreated", { seed: this.seed });
    this.initEconomy();
    this.initWarState();
  }

  private initWarState(): void {
    for (const c of this.scenario.countries) {
      if (!this.threat.has(c.countryId)) this.threat.set(c.countryId, 0);
    }
    // also ensure threat for any economy country
    for (const cid of this.getCountryIds()) {
      if (!this.threat.has(cid)) this.threat.set(cid, 0);
    }
  }

  private initEconomy(): void {
    try {
      const countries = countriesRaw as unknown as Array<{ countryId: string }>;
      const regions = regionsRaw as unknown as Array<{ regionId: string; countryId: string }>;
      const regionsByCountry = new Map<string, string[]>();
      for (const r of regions) {
        const arr = regionsByCountry.get(r.countryId) ?? [];
        arr.push(r.regionId);
        regionsByCountry.set(r.countryId, arr);
        // controller initially owner — keep in sync with regionStates if already present
        if (!this.regionController.has(r.regionId)) {
          this.regionController.set(r.regionId, r.countryId);
        }
      }
      for (const c of countries) {
        const regs = regionsByCountry.get(c.countryId) ?? [];
        if (!this.economies.has(c.countryId)) {
          const eco = createInitialEconomyForCountry(c.countryId, regs, ECONOMY_RULES);
          this.economies.set(c.countryId, eco);
        }
      }
    } catch (e) {
      if (this.economies.size === 0) {
        const eco = createInitialEconomyForCountry("GB", ["GB-1", "GB-2", "GB-3", "GB-4"], ECONOMY_RULES);
        this.economies.set("GB", eco);
        for (const rid of ["GB-1", "GB-2", "GB-3", "GB-4"]) {
          if (!this.regionController.has(rid)) this.regionController.set(rid, "GB");
        }
      }
    }
    // sync regionController with regionStates controller (in case army init already set them)
    for (const [rid, rs] of this.regionStates) {
      if (!this.regionController.has(rid)) this.regionController.set(rid, rs.controllerId);
    }
  }

  private initArmyState(): void {
    for (const r of this.scenario.regions) {
      const terrain = (r as unknown as { terrain?: string }).terrain ?? "plains";
      const isCap = !!(r as unknown as { isCapitalRegion?: boolean }).isCapitalRegion;
      const rs: RegionState = {
        regionId: r.regionId,
        countryId: r.countryId,
        ownerId: r.countryId,
        controllerId: r.countryId,
        terrain: terrain === "city" ? "city" : terrain === "mountains" ? "mountains" : "plains",
        fortLevel: isCap ? 1 : 0,
        isCapitalRegion: isCap,
      };
      this.regionStates.set(r.regionId, rs);
      if (isCap && !this.capitalRegionByCountry.has(r.countryId)) {
        this.capitalRegionByCountry.set(r.countryId, r.regionId);
      }
    }
    for (const c of this.scenario.countries) {
      if (!this.capitalRegionByCountry.has(c.countryId)) {
        const first = this.scenario.regions.find((rr) => rr.countryId === c.countryId);
        if (first) this.capitalRegionByCountry.set(c.countryId, first.regionId);
      }
      if (!this.countryEconomy.has(c.countryId)) {
        this.countryEconomy.set(c.countryId, {
          treasury: ARMY_RULES.initialCountry.treasury,
          population: ARMY_RULES.initialCountry.population,
          equipmentStock: ARMY_RULES.initialCountry.equipmentStock,
        });
      }
    }
  }

  // — queries (read-only)

  getDate(): string {
    return this.calendar.getDateString();
  }

  getDaysElapsed(): number {
    return this.calendar.getDaysElapsed();
  }

  getSeed(): number {
    return this.seed;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  /** Snapshot for tests / UI. Returns shallow copy. Union of T4 and T5 + T6 war. */
  getSnapshot(): SimSnapshot {
    const economies: Record<string, { treasury: number; debt: number; gdp: number; taxRate: number; weights: Record<string, number>; lastIncome: number; lastExpense: number; lastInterest: number; lastGrowthRate: number; lastSupport: number }> = {};
    for (const [cid, eco] of this.economies) {
      economies[cid] = {
        treasury: eco.treasury,
        debt: eco.debt,
        gdp: eco.gdp,
        taxRate: eco.taxRate,
        weights: { ...eco.weights },
        lastIncome: eco.lastIncome,
        lastExpense: eco.lastExpense,
        lastInterest: eco.lastInterest,
        lastGrowthRate: eco.lastGrowthRate,
        lastSupport: eco.lastSupport,
      };
    }
    const projects: Array<{ id: string; countryId: string; regionId: string; type: string; status: string; startDate: string; endDate: string }> = [];
    for (const eco of this.economies.values()) {
      for (const p of eco.activeProjects) projects.push({ id: p.id, countryId: p.countryId, regionId: p.regionId, type: p.type, status: p.status, startDate: p.startDate, endDate: p.endDate });
      for (const p of eco.completedProjects) projects.push({ id: p.id, countryId: p.countryId, regionId: p.regionId, type: p.type, status: p.status, startDate: p.startDate, endDate: p.endDate });
    }
    return {
      date: this.getDate(),
      daysElapsed: this.getDaysElapsed(),
      seed: this.seed,
      tickCount: this.tickCount,
      customState: { ...this.customState },
      economies,
      projects,
      units: this.getUnits(),
      regions: this.getRegionStates(),
      countryEconomy: this.getCountryEconomySnapshot(),
      wars: this.getWarsSnapshot(),
      threats: this.getAllThreats(),
    };
  }

  getCustomState(): Readonly<Record<string, number>> {
    return { ...this.customState };
  }

  /** Deterministic RNG access for tests (read-only peek). */
  getRngState(): number {
    return this.rng.getState();
  }

  peekRngNext(): number {
    const clone = this.rng.clone();
    return clone.next();
  }

  getEventLog(): readonly import("./types.js").SimEvent[] {
    return this.log.getAll();
  }

  getEventLogTail(n: number): readonly import("./types.js").SimEvent[] {
    return this.log.getTail(n);
  }

  // — economy queries (T4)

  getEconomy(countryId: string): Readonly<CountryEconomy> | undefined {
    const eco = this.economies.get(countryId);
    if (!eco) return undefined;
    return {
      ...eco,
      weights: { ...eco.weights },
      activeProjects: [...eco.activeProjects],
      completedProjects: [...eco.completedProjects],
      eduHistory: [...eco.eduHistory],
      controlledRegions: new Set(eco.controlledRegions),
    };
  }

  getAllEconomies(): ReadonlyMap<string, Readonly<CountryEconomy>> {
    return this.economies as ReadonlyMap<string, Readonly<CountryEconomy>>;
  }

  getCountryIds(): string[] {
    // union of both economy maps; prefer economies keys (16 countries)
    const ids = new Set<string>();
    for (const k of this.economies.keys()) ids.add(k);
    for (const k of this.countryEconomy.keys()) ids.add(k);
    return Array.from(ids).sort();
  }

  getRegionController(regionId: string): string | undefined {
    return this.regionController.get(regionId);
  }

  getProjects(countryId?: string): ReadonlyArray<import("./economy.js").Project> {
    if (countryId) {
      const eco = this.economies.get(countryId);
      if (!eco) return [];
      return [...eco.activeProjects, ...eco.completedProjects];
    }
    const all: import("./economy.js").Project[] = [];
    for (const eco of this.economies.values()) all.push(...eco.activeProjects, ...eco.completedProjects);
    return all;
  }

  forecastProject(countryId: string, regionId: string, projectType: ProjectType): EconomyForecast | null {
    const eco = this.economies.get(countryId);
    if (!eco) return null;
    return forecastProject(eco, projectType, regionId, ECONOMY_RULES, this.regionController);
  }

  forecastTax(countryId: string, newTax: number): ReturnType<typeof forecastTaxChange> | null {
    const eco = this.economies.get(countryId);
    if (!eco) return null;
    return forecastTaxChange(eco, newTax, ECONOMY_RULES);
  }

  forecastWeights(countryId: string, newWeights: ExpenseWeights): ReturnType<typeof forecastWeightsChange> | null {
    const eco = this.economies.get(countryId);
    if (!eco) return null;
    return forecastWeightsChange(eco, newWeights, ECONOMY_RULES);
  }

  // — T5 army queries

  getScenario(): Scenario {
    return this.scenario;
  }

  getUnits(): ArmyUnit[] {
    return Array.from(this.units.values()).map((u) => ({ ...u }));
  }

  getUnit(unitId: string): ArmyUnit | undefined {
    const u = this.units.get(unitId);
    return u ? { ...u } : undefined;
  }

  getUnitsByCountry(countryId: string): ArmyUnit[] {
    return this.getUnits().filter((u) => u.countryId === countryId);
  }

  getUnitsInRegion(regionId: string): ArmyUnit[] {
    return this.getUnits().filter((u) => u.regionId === regionId);
  }

  getRegionState(regionId: string): RegionState | undefined {
    const rs = this.regionStates.get(regionId);
    return rs ? { ...rs } : undefined;
  }

  getRegionStates(): RegionControllerState[] {
    return Array.from(this.regionStates.values()).map((rs) => ({
      regionId: rs.regionId,
      ownerId: rs.ownerId,
      controllerId: rs.controllerId,
      terrain: rs.terrain,
      fortLevel: rs.fortLevel,
      isCapitalRegion: rs.isCapitalRegion,
    }));
  }

  getCountryEconomy(countryId: string): CountryEconomyState | undefined {
    const ce = this.countryEconomy.get(countryId);
    return ce ? { ...ce } : undefined;
  }

  getCountryEconomySnapshot(): Record<string, CountryEconomyState> {
    const out: Record<string, CountryEconomyState> = {};
    for (const [k, v] of this.countryEconomy.entries()) out[k] = { ...v };
    return out;
  }

  getCapitalRegion(countryId: string): string | null {
    return this.capitalRegionByCountry.get(countryId) ?? null;
  }

  getDailyUpkeepCost(unitId: string): number | null {
    const u = this.units.get(unitId);
    if (!u) return null;
    return armyDailyUpkeepCost(u);
  }

  getMilitaryLayer(): {
    units: Array<ArmyUnit & { supplyPenalty: number; upkeep: number; strength: number }>;
    regions: RegionControllerState[];
    adjacency: Record<string, string[]>;
    crossings: Scenario["crossings"];
  } {
    const capFor = (cid: string) => this.getCapitalRegion(cid);
    const adj = this.scenario.adjacency;
    const crossings = this.scenario.crossings as unknown as Array<{ fromRegionId: string; toRegionId: string }>;
    const enriched = this.getUnits().map((u) => {
      const cap = capFor(u.countryId);
      const penalty = getSupplyPenalty(u.regionId, cap, adj, crossings);
      return {
        ...u,
        supplyPenalty: penalty,
        upkeep: armyDailyUpkeepCost(u),
        strength: calculateBaseStrength(u),
      };
    });
    return {
      units: enriched,
      regions: this.getRegionStates(),
      adjacency: this.scenario.adjacency,
      crossings: this.scenario.crossings,
    };
  }

  explainCombat(attackerId: string, defenderId: string): { ok: boolean; reason?: string; explanation?: string; breakdown?: { attackerBase: number; defenderBase: number } } {
    const att = this.units.get(attackerId);
    const def = this.units.get(defenderId);
    if (!att) return { ok: false, reason: `unknown attacker ${attackerId}` };
    if (!def) return { ok: false, reason: `unknown defender ${defenderId}` };
    const defRegion = this.regionStates.get(def.regionId) ?? null;
    const exp = explainCombat(att, def, defRegion);
    return {
      ok: true,
      explanation: exp,
      breakdown: { attackerBase: calculateBaseStrength(att), defenderBase: calculateBaseStrength(def) },
    };
  }

  getSupplyDistance(unitId: string): number | null {
    const u = this.units.get(unitId);
    if (!u) return null;
    const cap = this.getCapitalRegion(u.countryId);
    if (!cap) return null;
    const adj = this.scenario.adjacency;
    const crossings = this.scenario.crossings as unknown as Array<{ fromRegionId: string; toRegionId: string }>;
    return bfsDistance(cap, u.regionId, adj, crossings);
  }

  getSupplyPenaltyForUnit(unitId: string): number | null {
    const u = this.units.get(unitId);
    if (!u) return null;
    const cap = this.getCapitalRegion(u.countryId);
    const adj = this.scenario.adjacency;
    const crossings = this.scenario.crossings as unknown as Array<{ fromRegionId: string; toRegionId: string }>;
    return getSupplyPenalty(u.regionId, cap, adj, crossings);
  }

  // — T6 war queries

  getWars(): War[] {
    return Array.from(this.wars.values()).map((w) => ({ ...w }));
  }

  getWar(warId: string): War | undefined {
    const w = this.wars.get(warId);
    return w ? { ...w } : undefined;
  }

  getActiveWars(): War[] {
    return this.getWars().filter((w) => w.status === "active");
  }

  getWarsForCountry(countryId: string): War[] {
    return this.getWars().filter((w) => w.attackerId === countryId || w.defenderId === countryId);
  }

  getWarsSnapshot(): WarSnapshot[] {
    const nowDay = this.getDaysElapsed();
    return this.getWars().map((w) => {
      const occ = getOccupiedForWar(w, this.regionStates);
      const days = getWarDays(w, nowDay);
      return {
        warId: w.warId,
        attackerId: w.attackerId,
        defenderId: w.defenderId,
        startDay: w.startDay,
        startDate: w.startDate,
        status: w.status,
        endDay: w.endDay,
        endDate: w.endDate,
        endReason: w.endReason,
        exhaustionAttacker: w.exhaustionAttacker,
        exhaustionDefender: w.exhaustionDefender,
        daysAtWar: days,
        occupiedByAttacker: occ.occupiedByAttacker,
        occupiedByDefender: occ.occupiedByDefender,
      };
    });
  }

  getThreat(countryId: string): number {
    return this.threat.get(countryId) ?? 0;
  }

  getAllThreats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.threat.entries()) out[k] = v;
    return out;
  }

  isAtWar(a: string, b: string): boolean {
    for (const w of this.wars.values()) {
      if (w.status !== "active") continue;
      if ((w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a)) return true;
    }
    return false;
  }

  getOccupiedForWarId(warId: string): { occupiedByAttacker: string[]; occupiedByDefender: string[] } | null {
    const w = this.wars.get(warId);
    if (!w) return null;
    return getOccupiedForWar(w, this.regionStates);
  }

  forecastDeclareWar(attacker: string, defender: string): ReturnType<typeof forecastDeclareWarPure> {
    return forecastDeclareWarPure(attacker, defender, this.wars, this.getCountryIds());
  }

  forecastPeace(warId: string, proposer: string, type: PeaceType): { ok: boolean; reason?: string; aiPreview?: { accept: boolean; reasons: string[] }; available?: boolean } {
    const w = this.wars.get(warId);
    if (!w) return { ok: false, reason: WAR_RULES.messages.noWar };
    if (w.status !== "active") return { ok: false, reason: WAR_RULES.messages.warNotActive };
    if (proposer !== w.attackerId && proposer !== w.defenderId) return { ok: false, reason: WAR_RULES.messages.notParticipant };
    const responder = proposer === w.attackerId ? w.defenderId : w.attackerId;
    const occ = getOccupiedForWar(w, this.regionStates);
    const days = getWarDays(w, this.getDaysElapsed());
    const proposerUnits = this.getUnitsByCountry(proposer);
    const responderUnits = this.getUnitsByCountry(responder);
    const proposerStrength = totalStrength(proposerUnits);
    const responderStrength = totalStrength(responderUnits);
    const forceRatioResponder = computeForceRatio(responderStrength, proposerStrength);
    const exhResponder = responder === w.attackerId ? w.exhaustionAttacker : w.exhaustionDefender;
    const occupiedByProposer = proposer === w.attackerId ? occ.occupiedByAttacker.length : occ.occupiedByDefender.length;
    const occupiedByResponder = proposer === w.attackerId ? occ.occupiedByDefender.length : occ.occupiedByAttacker.length;
    const ai = evaluatePeaceAI({
      war: w,
      proposerId: proposer,
      responderId: responder,
      peaceType: type,
      forceRatioResponder,
      exhaustionResponder: exhResponder,
      exhaustionProposer: proposer === w.attackerId ? w.exhaustionAttacker : w.exhaustionDefender,
      occupiedByProposer,
      occupiedByResponder,
      daysAtWar: days,
    });
    return { ok: true, aiPreview: { accept: ai.accept, reasons: ai.reasons }, available: true };
  }

  private computeExhaustionForWar(w: War): void {
    const days = getWarDays(w, this.getDaysElapsed());
    const occ = getOccupiedForWar(w, this.regionStates);
    const attLost = occ.occupiedByDefender.length;
    const defLost = occ.occupiedByAttacker.length;
    const attOccupied = occ.occupiedByAttacker.length;
    const defOccupied = occ.occupiedByDefender.length;
    w.exhaustionAttacker = computeExhaustion(days, w.casualtiesAttacker, attOccupied, attLost);
    w.exhaustionDefender = computeExhaustion(days, w.casualtiesDefender, defOccupied, defLost);
  }

  private updateAllWarExhaustion(): void {
    for (const w of this.wars.values()) {
      if (w.status === "active") this.computeExhaustionForWar(w);
    }
  }

  private findWarForCountries(a: string, b: string): War | undefined {
    for (const w of this.wars.values()) {
      if (w.status !== "active") continue;
      if ((w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a)) return w;
    }
    return undefined;
  }

  // — commands

  dispatch(cmd: Command): ValidationResult {
    const v = validateCommand(cmd);
    if (!v.ok) {
      this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: v.reason }, v.reason);
      return v;
    }

    switch (cmd.type) {
      case "noop": {
        this.log.append(this.getDate(), "commandAccepted", { command: cmd }, "noop accepted");
        break;
      }
      case "testPing": {
        const msg = (cmd.payload as { message?: string } | undefined)?.message ?? "ping";
        this.log.append(this.getDate(), "testPing", { command: cmd }, msg);
        break;
      }
      case "incrementCounter": {
        const p = cmd.payload as { key: string; delta: number };
        const k = p.key;
        const d = p.delta;
        this.customState[k] = (this.customState[k] ?? 0) + d;
        const r = this.rng.next();
        this.log.append(this.getDate(), "incrementCounter", { key: k, delta: d, rng: r }, `counter ${k} += ${d}`);
        break;
      }
      case "setTax": {
        const p = cmd.payload as { countryId: string; taxRate: number };
        const eco = this.economies.get(p.countryId);
        if (!eco) {
          const reason = `неизвестная страна: ${p.countryId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        const err = validateTaxRate(p.taxRate, ECONOMY_RULES);
        if (err) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: err }, err);
          return { ok: false, reason: err };
        }
        const old = eco.taxRate;
        const f = forecastTaxChange(eco, p.taxRate, ECONOMY_RULES);
        eco.taxRate = p.taxRate;
        eco.lastIncome = computeMonthlyIncome(eco, ECONOMY_RULES);
        eco.lastGrowthRate = computeGrowthRate(eco, ECONOMY_RULES);
        eco.lastSupport = computeSupport(eco, ECONOMY_RULES);
        eco.lastChangeReason = f.reason;
        this.log.append(
          this.getDate(),
          "taxChanged",
          { countryId: p.countryId, oldTax: old, newTax: p.taxRate, forecast: f },
          `Налог ${p.countryId}: ${(old * 100).toFixed(0)}% → ${(p.taxRate * 100).toFixed(0)}%. ${f.reason}`
        );
        break;
      }
      case "setWeights": {
        const p = cmd.payload as { countryId: string; weights: ExpenseWeights };
        const eco = this.economies.get(p.countryId);
        if (!eco) {
          const reason = `неизвестная страна: ${p.countryId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        const err = validateWeights(p.weights, ECONOMY_RULES);
        if (err) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: err }, err);
          return { ok: false, reason: err };
        }
        const old = { ...eco.weights };
        const f = forecastWeightsChange(eco, p.weights, ECONOMY_RULES);
        eco.weights = { ...p.weights };
        eco.lastExpense = computeMonthlyExpense(eco, ECONOMY_RULES);
        eco.lastGrowthRate = computeGrowthRate(eco, ECONOMY_RULES);
        eco.lastSupport = computeSupport(eco, ECONOMY_RULES);
        eco.lastChangeReason = f.reason;
        this.log.append(
          this.getDate(),
          "weightsChanged",
          { countryId: p.countryId, oldWeights: old, newWeights: p.weights, forecast: f },
          `Веса расходов ${p.countryId} изменены. ${f.reason}`
        );
        break;
      }
      case "startProject": {
        const p = cmd.payload as { countryId: string; regionId: string; projectType: ProjectType };
        const eco = this.economies.get(p.countryId);
        if (!eco) {
          const reason = `неизвестная страна: ${p.countryId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        const forecast = forecastProject(eco, p.projectType, p.regionId, ECONOMY_RULES, this.regionController);
        if (forecast.unavailableReason) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: forecast.unavailableReason }, forecast.unavailableReason);
          return { ok: false, reason: forecast.unavailableReason };
        }
        const ctrl = this.regionController.get(p.regionId);
        if (ctrl !== p.countryId) {
          const reason = `регион ${p.regionId} не под вашим контролем (контролирует ${ctrl ?? "никто"})`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        const rule = ECONOMY_RULES.projects[p.projectType];
        const price = rule.price;
        const duration = rule.durationDays;
        const beforeTreasury = eco.treasury;
        const beforeDebt = eco.debt;
        if (eco.treasury >= price) {
          eco.treasury = Math.round((eco.treasury - price) * 100) / 100;
        } else {
          const need = price - eco.treasury;
          eco.treasury = 0;
          eco.debt = Math.round((eco.debt + need) * 100) / 100;
        }
        const proj = {
          id: `proj-${this.nextProjectId++}`,
          countryId: p.countryId,
          regionId: p.regionId,
          type: p.projectType,
          price,
          durationDays: duration,
          startDay: this.getDaysElapsed(),
          startDate: this.getDate(),
          endDay: this.getDaysElapsed() + duration,
          endDate: addDays(this.getDate(), duration),
          status: "active" as const,
        };
        eco.activeProjects.push(proj);
        eco.lastChangeReason = `Запущен ${rule.nameRu} в ${p.regionId}: цена ${price}, срок ${duration} дн.`;
        this.log.append(
          this.getDate(),
          "projectStarted",
          { project: proj, beforeTreasury, beforeDebt, afterTreasury: eco.treasury, afterDebt: eco.debt, forecast },
          `Старт ${rule.nameRu} в ${p.regionId} (${p.countryId}): цена ${price}, срок ${duration} дн. Казна ${beforeTreasury}→${eco.treasury}, долг ${beforeDebt}→${eco.debt}`
        );
        break;
      }
      case "setRegionController":
      case "loseRegion": {
        const p = cmd.payload as { regionId: string; newControllerId?: string; countryId?: string; targetCountryId?: string };
        const regionId = p.regionId;
        const current = this.regionController.get(regionId);
        if (!current) {
          const reason = `неизвестный регион: ${regionId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        let newCtrl: string | undefined = (p as { newControllerId?: string }).newControllerId;
        if (cmd.type === "loseRegion" && !newCtrl) {
          const all = this.getCountryIds();
          newCtrl = all.find((c) => c !== current);
          if ((p as { countryId?: string }).countryId && (p as { countryId?: string }).countryId !== current) {
            newCtrl = (p as { countryId?: string }).countryId;
          }
        }
        if (!newCtrl) {
          const reason = `не указан новый контролёр для ${regionId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        if (!this.economies.has(newCtrl)) {
          const reason = `неизвестная страна-контролёр: ${newCtrl}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        if (current === newCtrl) {
          const reason = `регион ${regionId} уже под контролем ${current}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        this.regionController.set(regionId, newCtrl);
        // also sync regionStates
        const rs = this.regionStates.get(regionId);
        if (rs) {
          rs.controllerId = newCtrl;
          this.regionStates.set(regionId, rs);
        }
        const oldEco = this.economies.get(current);
        const newEco = this.economies.get(newCtrl);
        if (oldEco) {
          oldEco.controlledRegions.delete(regionId);
          const beforeIncome = oldEco.lastIncome;
          oldEco.lastIncome = computeMonthlyIncome(oldEco, ECONOMY_RULES);
          oldEco.lastChangeReason = `Потерян регион ${regionId} → контроль перешёл к ${newCtrl}. Доход ${beforeIncome}→${oldEco.lastIncome} (промрегион бьёт по бюджету)`;
        }
        if (newEco) {
          newEco.controlledRegions.add(regionId);
          const beforeIncome = newEco.lastIncome;
          newEco.lastIncome = computeMonthlyIncome(newEco, ECONOMY_RULES);
          newEco.lastChangeReason = `Получен регион ${regionId} от ${current}. Доход ${beforeIncome}→${newEco.lastIncome}`;
        }
        this.log.append(
          this.getDate(),
          "regionControllerChanged",
          { regionId, from: current, to: newCtrl },
          `Регион ${regionId}: контроль ${current} → ${newCtrl}. Доход старого владельца пересчитан, промкомплексы потеряны.`
        );
        // update war exhaustion immediately
        this.updateAllWarExhaustion();
        break;
      }
      case "cancelProject": {
        const p = cmd.payload as { projectId: string };
        let found = false;
        for (const eco of this.economies.values()) {
          const idx = eco.activeProjects.findIndex((pr) => pr.id === p.projectId);
          if (idx !== -1) {
            const proj = eco.activeProjects[idx];
            eco.activeProjects.splice(idx, 1);
            this.log.append(this.getDate(), "projectCancelled", { project: proj }, `Проект ${proj.id} отменён в ${proj.regionId}`);
            found = true;
            break;
          }
        }
        if (!found) {
          const reason = `проект не найден: ${p.projectId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        break;
      }
      case "recruitUnit": {
        const res = this.handleRecruitUnit(cmd.payload as Record<string, unknown>);
        if (!res.ok) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: res.reason }, res.reason);
          return res;
        }
        break;
      }
      case "moveUnit": {
        const res = this.handleMoveUnit(cmd.payload as Record<string, unknown>);
        if (!res.ok) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: res.reason }, res.reason);
          return res;
        }
        break;
      }
      case "setStance": {
        const res = this.handleSetStance(cmd.payload as Record<string, unknown>);
        if (!res.ok) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: res.reason }, res.reason);
          return res;
        }
        break;
      }
      case "declareWar": {
        const res = this.handleDeclareWar(cmd.payload as Record<string, unknown>);
        if (!res.ok) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: res.reason }, res.reason);
          return res;
        }
        break;
      }
      case "proposePeace": {
        const res = this.handleProposePeace(cmd.payload as Record<string, unknown>);
        if (!res.ok) {
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: res.reason }, res.reason);
          return res;
        }
        break;
      }
      default: {
        this.log.append(this.getDate(), "commandAccepted", { command: cmd });
        break;
      }
    }
    return { ok: true };
  }

  private handleDeclareWar(payload: Record<string, unknown>): ValidationResult {
    const attacker = payload.attacker as string;
    const defender = payload.defender as string;
    const reasonText = (payload.reason as string | undefined) ?? "";
    const forecast = forecastDeclareWarPure(attacker, defender, this.wars, this.getCountryIds());
    if (!forecast.ok) {
      return { ok: false, reason: forecast.unavailableReason ?? forecast.reason };
    }
    if (attacker === defender) return { ok: false, reason: WAR_RULES.messages.selfWar };
    const known = new Set(this.getCountryIds());
    if (!known.has(attacker) || !known.has(defender)) return { ok: false, reason: `${WAR_RULES.messages.unknownCountry}: ${!known.has(attacker) ? attacker : defender}` };
    // check treasury cost (if any) — deduct from attacker economy? Cost 0 in A, so skip
    const cost = WAR_RULES.declareWar.treasuryCost;
    if (cost > 0) {
      const eco = this.economies.get(attacker);
      const ce = this.countryEconomy.get(attacker);
      if (eco) {
        if (eco.treasury >= cost) eco.treasury -= cost;
        else {
          const need = cost - eco.treasury;
          eco.treasury = 0;
          eco.debt += need;
        }
      }
      if (ce) ce.treasury -= cost;
    }
    const warId = `war-${this.nextWarId++}`;
    const war: War = {
      warId,
      attackerId: attacker,
      defenderId: defender,
      startDay: this.getDaysElapsed(),
      startDate: this.getDate(),
      status: "active",
      exhaustionAttacker: WAR_RULES.exhaustion.perDay, // slight initial
      exhaustionDefender: WAR_RULES.exhaustion.perDay,
      casualtiesAttacker: 0,
      casualtiesDefender: 0,
    };
    this.wars.set(warId, war);
    // threat
    const prevThreat = this.threat.get(attacker) ?? 0;
    const delta = WAR_RULES.threat.aggressionIncrease;
    const nextThreat = Math.min(WAR_RULES.threat.max, prevThreat + delta);
    this.threat.set(attacker, nextThreat);
    this.log.append(
      this.getDate(),
      "warDeclared",
      { warId, attacker, defender, reason: reasonText, cost, threatBefore: prevThreat, threatAfter: nextThreat, forecast: forecast.consequences },
      `война объявлена: ${attacker} → ${defender} (warId ${warId}). Цена казна ${cost}, угроза ${prevThreat}→${nextThreat}. Причины/последствия: ${forecast.consequences.join("; ")}${reasonText ? ` Причина: ${reasonText}` : ""}`
    );
    this.log.append(
      this.getDate(),
      "threatIncreased",
      { countryId: attacker, delta, before: prevThreat, after: nextThreat },
      `угроза ${attacker} +${delta}: ${prevThreat}→${nextThreat} (агрессия)`
    );
    this.computeExhaustionForWar(war);
    return { ok: true };
  }

  private handleProposePeace(payload: Record<string, unknown>): ValidationResult {
    const warId = payload.warId as string;
    const proposer = payload.proposer as string;
    const type = payload.type as PeaceType;
    const allowed: PeaceType[] = ["white", "annexOccupied", "indemnity"];
    if (!allowed.includes(type)) return { ok: false, reason: `${WAR_RULES.messages.unknownPeaceType}: ${type}` };
    const war = this.wars.get(warId);
    if (!war) return { ok: false, reason: WAR_RULES.messages.noWar };
    if (war.status !== "active") return { ok: false, reason: WAR_RULES.messages.warNotActive };
    if (proposer !== war.attackerId && proposer !== war.defenderId) return { ok: false, reason: WAR_RULES.messages.notParticipant };
    const responder = proposer === war.attackerId ? war.defenderId : war.attackerId;
    const occ = getOccupiedForWar(war, this.regionStates);
    const days = getWarDays(war, this.getDaysElapsed());
    const proposerUnits = this.getUnitsByCountry(proposer);
    const responderUnits = this.getUnitsByCountry(responder);
    const proposerStrength = totalStrength(proposerUnits);
    const responderStrength = totalStrength(responderUnits);
    const forceRatioResponder = computeForceRatio(responderStrength, proposerStrength);
    const exhResponder = responder === war.attackerId ? war.exhaustionAttacker : war.exhaustionDefender;
    const exhProposer = proposer === war.attackerId ? war.exhaustionAttacker : war.exhaustionDefender;
    const occupiedByProposer = proposer === war.attackerId ? occ.occupiedByAttacker.length : occ.occupiedByDefender.length;
    const occupiedByResponder = proposer === war.attackerId ? occ.occupiedByDefender.length : occ.occupiedByAttacker.length;

    const aiEval = evaluatePeaceAI({
      war,
      proposerId: proposer,
      responderId: responder,
      peaceType: type,
      forceRatioResponder,
      exhaustionResponder: exhResponder,
      exhaustionProposer: exhProposer,
      occupiedByProposer,
      occupiedByResponder,
      daysAtWar: days,
    });

    // log proposal
    this.log.append(
      this.getDate(),
      "peaceProposed",
      { warId, proposer, responder, type, forceRatioResponder, exhaustionResponder: exhResponder, occupiedByProposer, occupiedByResponder, daysAtWar: days, aiWouldAccept: aiEval.accept, reasons: aiEval.reasons, debug: aiEval.debug },
      `предложение мира ${type} в войне ${warId}: ${proposer} → ${responder}. ИИ ${aiEval.accept ? "согласен" : "отказывается"}: ${aiEval.reasons.join("; ")}`
    );

    if (!aiEval.accept) {
      this.log.append(
        this.getDate(),
        "peaceRejected",
        { warId, proposer, responder, type, reasons: aiEval.reasons, forceRatioResponder, exhaustionResponder: exhResponder, occupiedByProposer, daysAtWar: days, debug: aiEval.debug },
        `мир отклонён ${responder} (${type}): ${aiEval.reasons.join("; ")} (сила ${forceRatioResponder.toFixed(2)}, истощение ${exhResponder.toFixed(0)}, оккупировано ${occupiedByProposer})`
      );
      return { ok: true };
    }

    // ACCEPTED — perform peace effects
    war.status = "ended";
    war.endDay = this.getDaysElapsed();
    war.endDate = this.getDate();
    war.endReason = type;

    const annexedRegions: string[] = [];
    let indemnityAmount = 0;
    let indemnityFrom: string | null = null;
    let indemnityTo: string | null = null;

    if (type === "annexOccupied") {
      // legalize all current controller != owner where participants involved: owner→controller
      for (const rs of this.regionStates.values()) {
        const isOccupiedByAttacker = rs.ownerId === war.defenderId && rs.controllerId === war.attackerId;
        const isOccupiedByDefender = rs.ownerId === war.attackerId && rs.controllerId === war.defenderId;
        if (isOccupiedByAttacker || isOccupiedByDefender) {
          const prevOwner = rs.ownerId;
          rs.ownerId = rs.controllerId;
          this.regionStates.set(rs.regionId, rs);
          annexedRegions.push(rs.regionId);
          this.log.append(
            this.getDate(),
            "regionAnnexed",
            { regionId: rs.regionId, prevOwner, newOwner: rs.ownerId, warId, type },
            `аннексия: ${rs.regionId} владелец ${prevOwner}→${rs.ownerId} (контролёр ${rs.controllerId})`
          );
        }
      }
      // also need to ensure controlledRegions sets reflect? Those already track controller, not owner. For economy, loss of industrial region already handled via controller; but owner change doesn't affect income directly, only controller did. However annex legalizes, so future peace annex doesn't double count.
      // For completeness, no extra economy transfer.
    } else if (type === "indemnity") {
      const amount = WAR_RULES.peace.indemnityAmount;
      // Determine payer: loser pays winner. Loser is responder if responder is losing (as per AI score), otherwise proposer pays.
      // Since AI accepted, responder is likely losing, so responder pays proposer. That's the typical indemnity demand.
      // To make deterministic: if responder losing (forceRatio <1 or occupiedByProposer>0) then responder pays proposer, else proposer pays responder.
      const responderLosing = forceRatioResponder < 1 || occupiedByProposer > 0 || exhResponder >= WAR_RULES.ai.exhaustionHigh;
      let payer: string;
      let receiver: string;
      if (responderLosing) {
        payer = responder;
        receiver = proposer;
      } else {
        payer = proposer;
        receiver = responder;
      }
      indemnityFrom = payer;
      indemnityTo = receiver;
      indemnityAmount = amount;
      // Treasury transfer via economy (T4) + sync T5
      const payerEco = this.economies.get(payer);
      const payerCE = this.countryEconomy.get(payer);
      const receiverEco = this.economies.get(receiver);
      const receiverCE = this.countryEconomy.get(receiver);
      // Deduct from payer
      if (payerEco) {
        // If payerEco has enough treasury, deduct; else go to debt logic similar to project cost
        if (payerEco.treasury >= amount) {
          payerEco.treasury = Math.round((payerEco.treasury - amount) * 100) / 100;
        } else {
          const need = amount - payerEco.treasury;
          payerEco.treasury = 0;
          payerEco.debt = Math.round((payerEco.debt + need) * 100) / 100;
          // also record interest? Keep as is.
        }
        payerEco.lastChangeReason = `Контрибуция ${amount} выплачена ${receiver} по миру ${warId}`;
      }
      if (payerCE) {
        payerCE.treasury -= amount;
      }
      if (receiverEco) {
        receiverEco.treasury = Math.round((receiverEco.treasury + amount) * 100) / 100;
        receiverEco.lastChangeReason = `Контрибуция ${amount} получена от ${payer} по миру ${warId}`;
      }
      if (receiverCE) {
        receiverCE.treasury += amount;
      }
      this.log.append(
        this.getDate(),
        "indemnityPaid",
        { warId, type, amount, from: payer, to: receiver, payerTreasuryAfter: payerEco?.treasury, payerDebtAfter: payerEco?.debt, receiverTreasuryAfter: receiverEco?.treasury },
        `контрибуция ${amount}₥: ${payer} → ${receiver} по миру ${warId} (${type})`
      );
    } else {
      // white: status quo, no owner change, no indemnity
    }

    this.log.append(
      this.getDate(),
      "peaceAccepted",
      {
        warId,
        proposer,
        responder,
        type,
        reasons: aiEval.reasons,
        annexedRegions,
        indemnityAmount,
        indemnityFrom,
        indemnityTo,
        forceRatioResponder,
        exhaustionResponder: exhResponder,
        occupiedByProposer,
        daysAtWar: days,
      },
      `мир принят ${responder} (${type}): ${aiEval.reasons.join("; ")}${annexedRegions.length ? ` аннексировано ${annexedRegions.join(", ")}` : ""}${indemnityAmount ? ` контрибуция ${indemnityAmount} ${indemnityFrom}→${indemnityTo}` : ""}`
    );

    // update exhaustion one final time (ended)
    this.computeExhaustionForWar(war);
    return { ok: true };
  }

  private handleRecruitUnit(payload: Record<string, unknown>): ValidationResult {
    const countryId = payload.countryId as string;
    const regionId = payload.regionId as string;
    const personnelRaw = payload.personnel as number | undefined;
    const equipmentRaw = payload.equipment as number | undefined;
    const readinessRaw = payload.readiness as number | undefined;
    const unitIdRaw = payload.unitId as string | undefined;

    const personnel = typeof personnelRaw === "number" ? personnelRaw : ARMY_RULES.hiring.defaultPersonnel;
    const equipment = typeof equipmentRaw === "number" ? equipmentRaw : ARMY_RULES.hiring.defaultEquipment;
    const readiness = typeof readinessRaw === "number" ? readinessRaw : ARMY_RULES.hiring.defaultReadiness;

    const hv = validateHiringParams(personnel, equipment);
    if (!hv.ok) return hv;

    if (typeof readiness !== "number" || readiness < ARMY_RULES.hiring.readinessMin || readiness > ARMY_RULES.hiring.readinessMax) {
      return { ok: false, reason: `оснащение/готовность вне диапазона 0.5–1.0` };
    }

    const country = this.scenario.countries.find((c) => c.countryId === countryId);
    if (!country) return { ok: false, reason: `неизвестная страна ${countryId}` };
    const region = this.scenario.regions.find((r) => r.regionId === regionId);
    if (!region) return { ok: false, reason: `${ARMY_RULES.messages.unknownRegion}: ${regionId}` };
    const rs = this.regionStates.get(regionId);
    if (!rs) return { ok: false, reason: `нет состояния региона ${regionId}` };
    if (rs.ownerId !== countryId && rs.controllerId !== countryId) {
      return { ok: false, reason: ARMY_RULES.messages.regionNotOwned };
    }

    const economy = this.countryEconomy.get(countryId);
    if (!economy) return { ok: false, reason: `нет экономики для ${countryId}` };
    const cost = hiringCost(personnel, equipment);
    if (economy.treasury < cost.treasury) {
      return { ok: false, reason: `${ARMY_RULES.messages.insufficientTreasury}: нужно ${cost.treasury.toFixed(0)}, есть ${economy.treasury.toFixed(0)}` };
    }
    if (economy.population < cost.population) {
      return { ok: false, reason: `${ARMY_RULES.messages.insufficientPopulation}: нужно ${cost.population}, есть ${economy.population}` };
    }
    if (economy.equipmentStock < cost.equipmentStock) {
      return { ok: false, reason: `${ARMY_RULES.messages.insufficientEquipment}: нужно ${cost.equipmentStock}, есть ${economy.equipmentStock}` };
    }

    let unitId = unitIdRaw;
    if (!unitId) {
      unitId = `unit-${countryId}-${this.nextUnitSeq++}`;
      while (this.units.has(unitId)) {
        unitId = `unit-${countryId}-${this.nextUnitSeq++}`;
      }
    } else {
      if (this.units.has(unitId)) return { ok: false, reason: `unitId уже существует: ${unitId}` };
    }

    economy.treasury -= cost.treasury;
    economy.population -= cost.population;
    economy.equipmentStock -= cost.equipmentStock;

    const hiringDays = ARMY_RULES.hiring.timeDays;
    const unit: ArmyUnit = {
      unitId,
      countryId,
      regionId,
      personnel,
      equipment,
      readiness,
      stance: "defensive",
      supplyBase: regionId,
      daysUntilReady: hiringDays,
      hiringTimeDays: hiringDays,
    };
    this.units.set(unitId, unit);

    this.log.append(this.getDate(), "unitRecruited", { unitId, countryId, regionId, personnel, equipment, readiness, cost, hiringDays }, `найм ${unitId} ${personnel} чел. оснащ.${equipment} в ${regionId}, готовность через ${hiringDays} дн.`);
    return { ok: true };
  }

  private handleMoveUnit(payload: Record<string, unknown>): ValidationResult {
    const unitId = payload.unitId as string;
    const toRegionId = payload.toRegionId as string;

    const unit = this.units.get(unitId);
    if (!unit) return { ok: false, reason: `${ARMY_RULES.messages.unknownUnit}: ${unitId}` };
    if (unit.daysUntilReady > 0) {
      return { ok: false, reason: `${ARMY_RULES.messages.unitNotReady}: ${unitId} ещё ${unit.daysUntilReady} дн.` };
    }

    const fromRegionId = unit.regionId;
    const toRegionState = this.regionStates.get(toRegionId);
    if (!toRegionState) return { ok: false, reason: `${ARMY_RULES.messages.unknownRegion}: ${toRegionId}` };
    const fromRegionState = this.regionStates.get(fromRegionId);
    if (!fromRegionState) return { ok: false, reason: `нет состояния исходного региона ${fromRegionId}` };

    const adjacency = this.scenario.adjacency;
    const crossings = this.scenario.crossings as unknown as Array<{ fromRegionId: string; toRegionId: string }>;
    const moveCheck = canMove(fromRegionId, toRegionId, adjacency, crossings);
    if (!moveCheck.ok) {
      return { ok: false, reason: moveCheck.reason };
    }

    const targetController = toRegionState.controllerId;
    const isEnemy = targetController !== unit.countryId;
    if (isEnemy) {
      const defenders = this.getUnitsInRegion(toRegionId).filter((u) => u.countryId === targetController && u.daysUntilReady === 0);
      if (defenders.length > 0) {
        let defender = defenders[0];
        let best = calculateBaseStrength(defender);
        for (let i = 1; i < defenders.length; i++) {
          const s = calculateBaseStrength(defenders[i]);
          if (s > best) {
            best = s;
            defender = defenders[i];
          }
        }
        const attackerRegionState = fromRegionState;
        const defenderRegionState = toRegionState;
        const capFor = (cid: string) => this.getCapitalRegion(cid);
        const rngStateBefore = this.rng.getState();
        const result = resolveCombat(unit, defender, attackerRegionState, defenderRegionState, adjacency, crossings, capFor, this.rng);

        const attAfter = { ...unit };
        const defAfter = { ...defender };
        attAfter.personnel = Math.max(0, attAfter.personnel - result.attackerCasualties);
        defAfter.personnel = Math.max(0, defAfter.personnel - result.defenderCasualties);
        if (attAfter.personnel <= 0) {
          this.units.delete(unit.unitId);
        } else {
          this.units.set(unit.unitId, attAfter);
        }
        if (defAfter.personnel <= 0) {
          this.units.delete(defender.unitId);
        } else {
          this.units.set(defender.unitId, defAfter);
        }

        // record casualties to war if applicable
        const war = this.findWarForCountries(unit.countryId, defender.countryId);
        if (war) {
          // casualties attributed to respective sides (handle both directions)
          if (war.attackerId === unit.countryId) {
            war.casualtiesAttacker += result.attackerCasualties;
            war.casualtiesDefender += result.defenderCasualties;
          } else if (war.attackerId === defender.countryId) {
            war.casualtiesAttacker += result.defenderCasualties;
            war.casualtiesDefender += result.attackerCasualties;
          } else {
            // war between A and B but attacker/defender swapped relative to war orientation? Already covered both.
            // generic: if unit country is attacker side vs defender side
            // If war is between unit and defender, regardless of who is attacker in war declaration, casualties count per country.
            // We'll attribute per country id match:
            if (war.attackerId === unit.countryId) war.casualtiesAttacker += result.attackerCasualties;
            else if (war.defenderId === unit.countryId) war.casualtiesDefender += result.attackerCasualties;
            if (war.attackerId === defender.countryId) war.casualtiesAttacker += result.defenderCasualties;
            else if (war.defenderId === defender.countryId) war.casualtiesDefender += result.defenderCasualties;
          }
          this.computeExhaustionForWar(war);
        }

        if (result.winner === "attacker") {
          const prevController = toRegionState.controllerId;
          toRegionState.controllerId = unit.countryId;
          this.regionStates.set(toRegionId, toRegionState);
          // sync T4 maps
          this.regionController.set(toRegionId, unit.countryId);
          const oldEco = this.economies.get(prevController);
          const newEco = this.economies.get(unit.countryId);
          if (oldEco) {
            oldEco.controlledRegions.delete(toRegionId);
            oldEco.lastIncome = computeMonthlyIncome(oldEco, ECONOMY_RULES);
          }
          if (newEco) newEco.controlledRegions.add(toRegionId);
          if (this.units.has(unit.unitId)) {
            const movedAtt = this.units.get(unit.unitId)!;
            movedAtt.regionId = toRegionId;
            this.units.set(unit.unitId, movedAtt);
          }
          this.log.append(
            this.getDate(),
            "combat",
            {
              attackerId: unit.unitId,
              defenderId: defender.unitId,
              fromRegionId,
              toRegionId,
              winner: result.winner,
              attackerStrength: result.attackerStrength,
              defenderStrength: result.defenderStrength,
              breakdown: result.breakdown,
              attackerCasualties: result.attackerCasualties,
              defenderCasualties: result.defenderCasualties,
              captured: true,
              prevController,
              newController: unit.countryId,
              rngStateBefore,
              rngStateAfter: this.rng.getState(),
            },
            `бой ${fromRegionId}→${toRegionId}: ${unit.unitId} vs ${defender.unitId} победитель ${result.winner} ${result.captured ? "захват" : ""} ${result.breakdown.reason}`
          );
          if (result.winner === "attacker") {
            this.log.append(this.getDate(), "regionCaptured", { regionId: toRegionId, prevController, newController: unit.countryId, ownerUnchanged: toRegionState.ownerId }, `захват: контролёр ${toRegionId} ${prevController}→${unit.countryId}, владелец ${toRegionState.ownerId} неизменён`);
          }
        } else {
          this.log.append(
            this.getDate(),
            "combat",
            {
              attackerId: unit.unitId,
              defenderId: defender.unitId,
              fromRegionId,
              toRegionId,
              winner: result.winner,
              attackerStrength: result.attackerStrength,
              defenderStrength: result.defenderStrength,
              breakdown: result.breakdown,
              attackerCasualties: result.attackerCasualties,
              defenderCasualties: result.defenderCasualties,
              captured: false,
              rngStateBefore,
              rngStateAfter: this.rng.getState(),
            },
            `бой отбит ${toRegionId}: ${defender.unitId} удержал, ${result.breakdown.reason}`
          );
        }
        // update war exhaustion after occupation change
        this.updateAllWarExhaustion();
        return { ok: true };
      } else {
        const prevController = toRegionState.controllerId;
        toRegionState.controllerId = unit.countryId;
        this.regionStates.set(toRegionId, toRegionState);
        this.regionController.set(toRegionId, unit.countryId);
        const oldEco = this.economies.get(prevController);
        const newEco = this.economies.get(unit.countryId);
        if (oldEco) {
          oldEco.controlledRegions.delete(toRegionId);
          oldEco.lastIncome = computeMonthlyIncome(oldEco, ECONOMY_RULES);
        }
        if (newEco) newEco.controlledRegions.add(toRegionId);
        unit.regionId = toRegionId;
        this.units.set(unit.unitId, unit);
        this.log.append(this.getDate(), "regionCaptured", { regionId: toRegionId, prevController, newController: unit.countryId, ownerUnchanged: toRegionState.ownerId, via: moveCheck.via }, `захват без боя ${toRegionId} ${prevController}→${unit.countryId} (чья земля: владелец ${toRegionState.ownerId})`);
        this.log.append(this.getDate(), "unitMoved", { unitId, fromRegionId, toRegionId, via: moveCheck.via, capturedEmpty: true }, `перемещение ${unitId} ${fromRegionId}→${toRegionId} через ${moveCheck.via}, захват пустого`);
        this.updateAllWarExhaustion();
        return { ok: true };
      }
    } else {
      const prevRegion = unit.regionId;
      unit.regionId = toRegionId;
      this.units.set(unit.unitId, unit);
      this.log.append(this.getDate(), "unitMoved", { unitId, fromRegionId: prevRegion, toRegionId, via: moveCheck.via }, `перемещение ${unitId} ${prevRegion}→${toRegionId} через ${moveCheck.via}`);
      return { ok: true };
    }
  }

  private handleSetStance(payload: Record<string, unknown>): ValidationResult {
    const unitId = payload.unitId as string;
    const stance = payload.stance as string;
    const unit = this.units.get(unitId);
    if (!unit) return { ok: false, reason: `${ARMY_RULES.messages.unknownUnit}: ${unitId}` };
    if (!VALID_STANCES.has(stance)) return { ok: false, reason: `неизвестная стойка ${stance}` };
    unit.stance = stance as Stance;
    this.units.set(unitId, unit);
    this.log.append(this.getDate(), "stanceChanged", { unitId, stance }, `стойка ${unitId} → ${stance}`);
    return { ok: true };
  }

  // — time

  private checkProjectCompletions(): void {
    const nowDay = this.getDaysElapsed();
    const nowDate = this.getDate();
    for (const eco of this.economies.values()) {
      const toComplete: typeof eco.activeProjects = [];
      const remaining: typeof eco.activeProjects = [];
      for (const p of eco.activeProjects) {
        if (nowDay >= p.endDay) toComplete.push(p);
        else remaining.push(p);
      }
      if (toComplete.length > 0) {
        eco.activeProjects = remaining;
        for (const p of toComplete) {
          p.status = "completed";
          eco.completedProjects.push(p);
          const rule = ECONOMY_RULES.projects[p.type];
          eco.gdp = Math.round((eco.gdp + rule.gdpBonus) * 100) / 100;
          const beforeIncome = eco.lastIncome;
          eco.lastIncome = computeMonthlyIncome(eco, ECONOMY_RULES);
          eco.lastGrowthRate = computeGrowthRate(eco, ECONOMY_RULES);
          this.log.append(
            nowDate,
            "projectCompleted",
            { project: p, gdpBonus: rule.gdpBonus, incomeBonus: rule.incomeBonus, beforeIncome, afterIncome: eco.lastIncome },
            `Завершён ${rule.nameRu} в ${p.regionId} (${p.countryId}): +${rule.gdpBonus} к ВВП, +${rule.incomeBonus} к доходу. Доход ${beforeIncome}→${eco.lastIncome}`
          );
        }
      }
    }
  }

  private runMonthlyEconomyTick(): void {
    const date = this.getDate();
    for (const eco of this.economies.values()) {
      const beforeTreasury = eco.treasury;
      const beforeDebt = eco.debt;
      const beforeGdp = eco.gdp;
      const res = processMonthlyTick(eco, ECONOMY_RULES);
      this.log.append(
        date,
        "monthlyTick",
        {
          countryId: eco.countryId,
          income: res.income,
          expense: res.expense,
          interest: res.interest,
          net: res.net,
          growthRate: res.growthRate,
          support: res.support,
          gdpBefore: res.gdpBefore,
          gdpAfter: res.gdpAfter,
          treasuryBefore: beforeTreasury,
          treasuryAfter: eco.treasury,
          debtBefore: beforeDebt,
          debtAfter: eco.debt,
        },
        `Эконом-тик ${eco.countryId} ${date}: доход ${res.income}, расход ${res.expense} (проценты ${res.interest}), баланс ${res.net}, казна ${beforeTreasury}→${eco.treasury}, долг ${beforeDebt}→${eco.debt}, ВВП ${res.gdpBefore}→${res.gdpAfter}, рост ${(res.growthRate * 100).toFixed(2)}%, поддержка ${res.support.toFixed(1)}`
      );
    }
  }

  /**
   * Advance simulation by integer game days.
   * Union tick: daily army (recruitment + upkeep) + project completions + monthly economy at day 1 + war exhaustion
   */
  tick(days: number): void {
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(`tick days must be non-negative integer, got ${days}`);
    }
    if (days === 0) return;

    for (let i = 0; i < days; i++) {
      this.calendar.tick(1);
      this.tickCount += 1;
      const dailyRand = this.rng.next();
      this.checkProjectCompletions();
      this.processDailyArmyTick();
      this.updateAllWarExhaustion();
      const dateStr = this.getDate();
      const day = Number(dateStr.slice(8, 10));
      if (day === 1) {
        this.runMonthlyEconomyTick();
      }
      if (this.tickCount === 1 || this.tickCount % 30 === 0) {
        this.log.append(this.getDate(), "dayTick", { daysElapsed: this.getDaysElapsed(), dailyRand });
      }
    }
  }

  private processDailyArmyTick(): void {
    for (const unit of this.units.values()) {
      if (unit.daysUntilReady > 0) {
        unit.daysUntilReady -= 1;
        if (unit.daysUntilReady === 0) {
          this.log.append(this.getDate(), "unitReady", { unitId: unit.unitId, regionId: unit.regionId }, `отряд ${unit.unitId} готов к бою в ${unit.regionId}`);
        }
      }
    }
    for (const unit of this.units.values()) {
      const cost = armyDailyUpkeepCost(unit);
      const econ = this.countryEconomy.get(unit.countryId);
      if (!econ) continue;
      econ.treasury -= cost;
      if (this.tickCount % 7 === 0) {
        this.log.append(this.getDate(), "upkeepDeducted", { unitId: unit.unitId, countryId: unit.countryId, cost, treasuryAfter: econ.treasury }, `содержание ${unit.unitId}: -${cost.toFixed(2)}, казна ${econ.treasury.toFixed(2)}`);
      }
      if (econ.treasury < 0 && this.tickCount % 7 === 0) {
        this.log.append(this.getDate(), "treasuryWarning", { countryId: unit.countryId, treasury: econ.treasury }, `казна ${unit.countryId} отрицательна: ${econ.treasury.toFixed(2)}`);
      }
    }
  }
}

/** Factory — preferred entry point for tests and UI. */
export function createSim(config?: { seed?: number; startDate?: string }): SimEngine {
  return new SimEngine(config);
}
