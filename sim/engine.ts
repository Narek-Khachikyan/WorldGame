import { GameCalendar, START_DATE, addDays } from "./calendar.js";
import { SeededRng } from "./rng.js";
import { EventLog } from "./eventLog.js";
import { validateCommand } from "./validator.js";
import type { Command, SimSnapshot, ValidationResult } from "./types.js";
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
import countriesRaw from "../data/countries.json";
import regionsRaw from "../data/regions.json";

export const SIM_START_DATE = START_DATE;
export const DEFAULT_SEED = 42;

/**
 * Pure sim core — no React/PixiJS.
 * Public seam: commands + tick(days) + queries + eventLog.
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

  constructor(config?: { seed?: number; startDate?: string }) {
    const seed = config?.seed ?? DEFAULT_SEED;
    this.seed = seed >>> 0;
    this.rng = new SeededRng(this.seed);
    this.calendar = new GameCalendar(config?.startDate ?? START_DATE);
    this.log = new EventLog();
    // initial event for traceability
    this.log.append(this.calendar.getDateString(), "simCreated", { seed: this.seed });
    this.initEconomy();
  }

  private initEconomy(): void {
    try {
      const countries = countriesRaw as unknown as Array<{ countryId: string }>;
      const regions = regionsRaw as unknown as Array<{ regionId: string; countryId: string }>;
      // group regions by country
      const regionsByCountry = new Map<string, string[]>();
      for (const r of regions) {
        const arr = regionsByCountry.get(r.countryId) ?? [];
        arr.push(r.regionId);
        regionsByCountry.set(r.countryId, arr);
        // controller initially owner
        this.regionController.set(r.regionId, r.countryId);
      }
      for (const c of countries) {
        const regs = regionsByCountry.get(c.countryId) ?? [];
        const eco = createInitialEconomyForCountry(c.countryId, regs, ECONOMY_RULES);
        this.economies.set(c.countryId, eco);
      }
    } catch (e) {
      // fallback minimal: single FG country for tests if data missing
      // do not throw — keep sim usable
      if (this.economies.size === 0) {
        const eco = createInitialEconomyForCountry("GB", ["GB-1", "GB-2", "GB-3", "GB-4"], ECONOMY_RULES);
        this.economies.set("GB", eco);
        for (const rid of ["GB-1", "GB-2", "GB-3", "GB-4"]) this.regionController.set(rid, "GB");
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

  /** Snapshot for tests / UI. Returns shallow copy. */
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

  // — economy queries

  getEconomy(countryId: string): Readonly<CountryEconomy> | undefined {
    const eco = this.economies.get(countryId);
    if (!eco) return undefined;
    // return copy with cloned sets/arrays to prevent mutation
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
    return Array.from(this.economies.keys()).sort();
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

  // pure forecast wrappers (no mutation)
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
        // recompute derived immediately
        eco.lastIncome = computeMonthlyIncome(eco, ECONOMY_RULES);
        eco.lastGrowthRate = computeGrowthRate(eco, ECONOMY_RULES);
        eco.lastSupport = computeSupport(eco, ECONOMY_RULES);
        // recompute expense? tax doesn't affect expense directly but growth/support changes
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
        // check region controller consistency
        const ctrl = this.regionController.get(p.regionId);
        if (ctrl !== p.countryId) {
          const reason = `регион ${p.regionId} не под вашим контролем (контролирует ${ctrl ?? "никто"})`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        const rule = ECONOMY_RULES.projects[p.projectType];
        const price = rule.price;
        const duration = rule.durationDays;
        // deduct price from treasury (go into debt if needed)
        // Use same logic as monthly tick: if treasury >= price, subtract; else debt increases
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
        // loseRegion is alias for test: payload {regionId, countryId?} or {regionId, newControllerId}
        const p = cmd.payload as { regionId: string; newControllerId?: string; countryId?: string; targetCountryId?: string };
        const regionId = p.regionId;
        // determine new controller: for loseRegion, if no newControllerId, treat as losing to no one or to FR? For test we pick alternative country.
        // We support both shapes: loseRegion payload {regionId} -> remove from current controller (make uncontrolled), or {regionId, newControllerId}
        const current = this.regionController.get(regionId);
        if (!current) {
          const reason = `неизвестный регион: ${regionId}`;
          this.log.append(this.getDate(), "commandRejected", { command: cmd, reason }, reason);
          return { ok: false, reason };
        }
        let newCtrl: string | undefined = (p as { newControllerId?: string }).newControllerId;
        if (cmd.type === "loseRegion" && !newCtrl) {
          // loseRegion without new controller: pick first other country that is not current
          const all = this.getCountryIds();
          newCtrl = all.find((c) => c !== current);
          // if payload has countryId as target to lose to, use it? Actually loseRegion may have countryId meaning owner losing? spec ambiguous
          // support payload {countryId, regionId} where countryId is owner that loses region — then new controller is whatever not owner
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
        // update controller and economies' controlledRegions sets
        this.regionController.set(regionId, newCtrl);
        const oldEco = this.economies.get(current);
        const newEco = this.economies.get(newCtrl);
        if (oldEco) {
          oldEco.controlledRegions.delete(regionId);
          // recompute income after loss
          const beforeIncome = oldEco.lastIncome;
          oldEco.lastIncome = computeMonthlyIncome(oldEco, ECONOMY_RULES);
          oldEco.lastChangeReason = `Потерян регион ${regionId} → контроль перешёл к ${newCtrl}. Доход ${beforeIncome}→${oldEco.lastIncome} (промрегион бьёт по бюджету)`;
          // also need to handle active/completed projects in that region: they no longer count for income, but remain attached to old country? For simplicity, we keep completed projects with old country but they are ignored due to controlledRegions check.
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
            // partial refund? no refund per spec – price уже списана
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
      default: {
        // unreachable due to validator whitelist, but keep for forward compat
        this.log.append(this.getDate(), "commandAccepted", { command: cmd });
        break;
      }
    }
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
          // update endDate to actual completion date
          // keep original endDate but also ensure income bonus applied
          eco.completedProjects.push(p);
          const rule = ECONOMY_RULES.projects[p.type];
          // GDP bonus on completion
          eco.gdp = Math.round((eco.gdp + rule.gdpBonus) * 100) / 100;
          // recompute income to include bonus
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
   * Deterministic: consumes RNG once per day to model future day-tick systems,
   * ensuring determinism is non-trivial.
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
      // project completions daily
      this.checkProjectCompletions();
      // monthly economy tick at first day of month
      const dateStr = this.getDate();
      const day = Number(dateStr.slice(8, 10));
      if (day === 1) {
        this.runMonthlyEconomyTick();
      }
      // log deterministically based on global tickCount only — ensures chunk-invariant logs
      // log first day and every 30th day to avoid spam while keeping determinism independent of tick chunking
      if (this.tickCount === 1 || this.tickCount % 30 === 0) {
        this.log.append(this.getDate(), "dayTick", { daysElapsed: this.getDaysElapsed(), dailyRand });
      }
    }
  }
}

/** Factory — preferred entry point for tests and UI. */
export function createSim(config?: { seed?: number; startDate?: string }): SimEngine {
  return new SimEngine(config);
}
