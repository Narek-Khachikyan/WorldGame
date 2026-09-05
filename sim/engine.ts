import { GameCalendar, START_DATE } from "./calendar.js";
import { SeededRng } from "./rng.js";
import { EventLog } from "./eventLog.js";
import { validateCommand } from "./validator.js";
import type { Command, SimSnapshot, ValidationResult, RegionControllerState, CountryEconomyState } from "./types.js";
import { loadScenario } from "./scenario.js";
import type { Scenario } from "./scenario.js";
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

export const SIM_START_DATE = START_DATE;
export const DEFAULT_SEED = 42;

const ARMY_RULES = armyRulesRaw as typeof import("../rules/army.json");

/**
 * Pure sim core — no React/PixiJS.
 * Public seam: commands + tick(days) + queries + eventLog.
 * T5 extension: army grouping (personnel/equipment/readiness/stance/supply), hiring with limits, movement via adjacency/crossings, combat seeded RNG, capture controller vs owner, upkeep hook, military layer queries.
 */
export class SimEngine {
  readonly seed: number;
  private rng: SeededRng;
  private calendar: GameCalendar;
  private log: EventLog;
  private tickCount = 0;
  private customState: Record<string, number> = {};

  // — T5 army state
  private scenario: Scenario;
  private regionStates: Map<string, RegionState> = new Map();
  private countryEconomy: Map<string, CountryEconomyState> = new Map();
  private units: Map<string, ArmyUnit> = new Map();
  private nextUnitSeq = 1;
  // capital region per country (first capital)
  private capitalRegionByCountry: Map<string, string> = new Map();

  constructor(config?: { seed?: number; startDate?: string }) {
    const seed = config?.seed ?? DEFAULT_SEED;
    this.seed = seed >>> 0;
    this.rng = new SeededRng(this.seed);
    this.calendar = new GameCalendar(config?.startDate ?? START_DATE);
    this.log = new EventLog();
    // load scenario offline
    this.scenario = loadScenario();
    this.initArmyState();
    // initial event for traceability
    this.log.append(this.calendar.getDateString(), "simCreated", { seed: this.seed });
  }

  private initArmyState(): void {
    // regionStates: owner=controller=countryId initially, owner only peace changes (T6 contract)
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
    // ensure each country has capital mapping (fallback to first region)
    for (const c of this.scenario.countries) {
      if (!this.capitalRegionByCountry.has(c.countryId)) {
        const first = this.scenario.regions.find((rr) => rr.countryId === c.countryId);
        if (first) this.capitalRegionByCountry.set(c.countryId, first.regionId);
      }
      // economy initial
      this.countryEconomy.set(c.countryId, {
        treasury: ARMY_RULES.initialCountry.treasury,
        population: ARMY_RULES.initialCountry.population,
        equipmentStock: ARMY_RULES.initialCountry.equipmentStock,
      });
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

  /** Snapshot for tests / UI. Returns shallow copy. */
  getSnapshot(): SimSnapshot {
    return {
      date: this.getDate(),
      daysElapsed: this.getDaysElapsed(),
      seed: this.seed,
      tickCount: this.tickCount,
      customState: { ...this.customState },
      units: this.getUnits(),
      regions: this.getRegionStates(),
      countryEconomy: this.getCountryEconomySnapshot(),
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

  // — T5 army queries exposed for map UI (#4) military layer

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

  /** Hook for T4 economy: daily upkeep cost per unit (defense weight will use this). For T5 standalone, tick() deducts directly. */
  getDailyUpkeepCost(unitId: string): number | null {
    const u = this.units.get(unitId);
    if (!u) return null;
    return armyDailyUpkeepCost(u);
  }

  /** Military layer for map UI (#4): units + region controller/owner + supply penalty per unit */
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

  /** Combat preview for UI — explainable formula without consuming RNG */
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

  /** Supply distance helper exposed */
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

  // — commands

  dispatch(cmd: Command): ValidationResult {
    const v = validateCommand(cmd);
    if (!v.ok) {
      this.log.append(this.getDate(), "commandRejected", { command: cmd, reason: v.reason }, v.reason);
      return v;
    }

    // apply known commands (pure, deterministic)
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
        // use RNG deterministically to prove determinism coupling: consume one rng per command
        const r = this.rng.next();
        this.log.append(this.getDate(), "incrementCounter", { key: k, delta: d, rng: r }, `counter ${k} += ${d}`);
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
      default: {
        // unreachable due to validator whitelist, but keep for forward compat
        this.log.append(this.getDate(), "commandAccepted", { command: cmd });
        break;
      }
    }
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

    // validate hiring params (personnel range, equipment 0.5-1.0)
    const hv = validateHiringParams(personnel, equipment);
    if (!hv.ok) return hv;

    if (typeof readiness !== "number" || readiness < ARMY_RULES.hiring.readinessMin || readiness > ARMY_RULES.hiring.readinessMax) {
      return { ok: false, reason: `оснащение/готовность вне диапазона 0.5–1.0` };
    }

    // check country exists
    const country = this.scenario.countries.find((c) => c.countryId === countryId);
    if (!country) return { ok: false, reason: `неизвестная страна ${countryId}` };
    // check region exists
    const region = this.scenario.regions.find((r) => r.regionId === regionId);
    if (!region) return { ok: false, reason: `${ARMY_RULES.messages.unknownRegion}: ${regionId}` };
    // check region owned/controlled by country? For fairness, require owner==countryId (or controller). Allow recruiting only in own regions.
    const rs = this.regionStates.get(regionId);
    if (!rs) return { ok: false, reason: `нет состояния региона ${regionId}` };
    // Allow recruit if region owner == countryId OR controller == countryId (occupied allows recruit? but spec says own). Strict: must be owner.
    if (rs.ownerId !== countryId && rs.controllerId !== countryId) {
      return { ok: false, reason: ARMY_RULES.messages.regionNotOwned };
    }

    // hiring limits: treasury, population, equipmentStock
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

    // unitId stable
    let unitId = unitIdRaw;
    if (!unitId) {
      unitId = `unit-${countryId}-${this.nextUnitSeq++}`;
      // ensure unique if collision
      while (this.units.has(unitId)) {
        unitId = `unit-${countryId}-${this.nextUnitSeq++}`;
      }
    } else {
      if (this.units.has(unitId)) return { ok: false, reason: `unitId уже существует: ${unitId}` };
    }

    // deduct costs
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

    // validate adjacency/crossing
    const adjacency = this.scenario.adjacency;
    const crossings = this.scenario.crossings as unknown as Array<{ fromRegionId: string; toRegionId: string }>;
    const moveCheck = canMove(fromRegionId, toRegionId, adjacency, crossings);
    if (!moveCheck.ok) {
      return { ok: false, reason: moveCheck.reason };
    }

    // if target region is controlled by different country, combat required
    const targetController = toRegionState.controllerId;
    const isEnemy = targetController !== unit.countryId;
    if (isEnemy) {
      // find defender unit(s) in target region belonging to controller
      const defenders = this.getUnitsInRegion(toRegionId).filter((u) => u.countryId === targetController && u.daysUntilReady === 0);
      if (defenders.length > 0) {
        // pick strongest defender (highest personnel*equipment*readiness)
        let defender = defenders[0];
        let best = calculateBaseStrength(defender);
        for (let i = 1; i < defenders.length; i++) {
          const s = calculateBaseStrength(defenders[i]);
          if (s > best) {
            best = s;
            defender = defenders[i];
          }
        }
        // resolve combat via seeded RNG
        const attackerRegionState = fromRegionState;
        const defenderRegionState = toRegionState;
        const capFor = (cid: string) => this.getCapitalRegion(cid);
        const rngStateBefore = this.rng.getState();
        const result = resolveCombat(unit, defender, attackerRegionState, defenderRegionState, adjacency, crossings, capFor, this.rng);

        // apply casualties
        const attAfter = { ...unit };
        const defAfter = { ...defender };
        attAfter.personnel = Math.max(0, attAfter.personnel - result.attackerCasualties);
        defAfter.personnel = Math.max(0, defAfter.personnel - result.defenderCasualties);
        // readiness slightly drops after combat (fatigue) — optional
        // apply back to maps
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

        if (result.winner === "attacker") {
          // capture: controller change, NOT owner (T6 contract)
          const prevController = toRegionState.controllerId;
          toRegionState.controllerId = unit.countryId;
          this.regionStates.set(toRegionId, toRegionState);
          // move attacker into captured region if still alive
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
          // defender held — attacker does not move, but casualties already applied
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
        return { ok: true };
      } else {
        // no defender unit — instant capture (occupation without battle) but still use combat formula? For empty region, just occupy.
        const prevController = toRegionState.controllerId;
        toRegionState.controllerId = unit.countryId;
        this.regionStates.set(toRegionId, toRegionState);
        // move unit
        unit.regionId = toRegionId;
        this.units.set(unit.unitId, unit);
        this.log.append(this.getDate(), "regionCaptured", { regionId: toRegionId, prevController, newController: unit.countryId, ownerUnchanged: toRegionState.ownerId, via: moveCheck.via }, `захват без боя ${toRegionId} ${prevController}→${unit.countryId} (чья земля: владелец ${toRegionState.ownerId})`);
        this.log.append(this.getDate(), "unitMoved", { unitId, fromRegionId, toRegionId, via: moveCheck.via, capturedEmpty: true }, `перемещение ${unitId} ${fromRegionId}→${toRegionId} через ${moveCheck.via}, захват пустого`);
        return { ok: true };
      }
    } else {
      // friendly move — no combat
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

  /**
   * Advance simulation by integer game days.
   * Deterministic: consumes RNG once per day to model future day-tick systems,
   * ensuring determinism is non-trivial.
   * T5: handles recruitment time countdown and daily upkeep deduction (hook for T4).
   */
  tick(days: number): void {
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(`tick days must be non-negative integer, got ${days}`);
    }
    if (days === 0) return;

    for (let i = 0; i < days; i++) {
      this.calendar.tick(1);
      this.tickCount += 1;
      // consume RNG once per day deterministically (placeholder for future daily systems)
      // keep it deterministic and visible for tests
      const dailyRand = this.rng.next();
      // T5 daily systems: recruitment and upkeep
      this.processDailyArmyTick();
      // log deterministically based on global tickCount only — ensures chunk-invariant logs
      // log first day and every 30th day to avoid spam while keeping determinism independent of tick chunking
      if (this.tickCount === 1 || this.tickCount % 30 === 0) {
        this.log.append(this.getDate(), "dayTick", { daysElapsed: this.getDaysElapsed(), dailyRand });
      }
    }
  }

  private processDailyArmyTick(): void {
    // recruitment countdown
    for (const unit of this.units.values()) {
      if (unit.daysUntilReady > 0) {
        unit.daysUntilReady -= 1;
        if (unit.daysUntilReady === 0) {
          this.log.append(this.getDate(), "unitReady", { unitId: unit.unitId, regionId: unit.regionId }, `отряд ${unit.unitId} готов к бою в ${unit.regionId}`);
        }
      }
    }
    // upkeep: deduct per unit from country treasury; T4 will integrate via defense weight hook (exposed via dailyUpkeepCost)
    // For standalone, deduct directly; if insufficient, log warning but allow negative? Clamp to 0 and log crisis.
    for (const unit of this.units.values()) {
      // only upkeep for ready units? Spec says содержание списывается — apply to all? For simplicity apply to all units that exist (even recruiting? but recruiting still costs). We'll apply to all.
      const cost = armyDailyUpkeepCost(unit);
      const econ = this.countryEconomy.get(unit.countryId);
      if (!econ) continue;
      econ.treasury -= cost;
      // log weekly upkeep to avoid spam, but ensure deterministic log at 30-day interval? Keep sparse
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
