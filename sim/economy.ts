/**
 * Economy A — sim + panel logic.
 * Pure TS, no React. Facts in data/, coefficients in rules/economy.json.
 * Monthly tick aggregates daily→monthly inside SimEngine.tick(days).
 * Treasury/income/expense separately (GDP is not wallet), single tax slider,
 * 4 expense weights (defense, infra, social, edu/science with lag), 3 construction types.
 */
import economyRulesRaw from "../rules/economy.json";
import { parseGameDate, formatGameDate, addDays } from "./calendar.js";

// — rules type (mirrors JSON)
export interface EconomyRules {
  treasury: { initial: number };
  gdp: { baseMonthly: number; baseRate: number };
  income: {
    tax: {
      min: number;
      max: number;
      default: number;
      step: number;
      growthPenaltyFactor: number;
      supportPenaltyFactor: number;
    };
    projectBonus: Record<ProjectType, number>;
  };
  expense: {
    caps: Record<ExpenseCategory, number>;
    defaultWeights: Record<ExpenseCategory, number>;
    eduLagMonths: number;
  };
  growth: { baseRate: number; infraFactor: number; eduFactor: number };
  support: { base: number; socialFactor: number; taxFactor: number; infraFactor: number };
  debt: { interestRateMonthly: number };
  projects: Record<ProjectType, ProjectRule>;
}

export interface ProjectRule {
  price: number;
  durationDays: number;
  slotLimitPerRegion: number;
  incomeBonus: number;
  gdpBonus: number;
  nameRu: string;
  descriptionRu: string;
  riskRu: string;
}

export type ProjectType = "industrialComplex" | "powerUnit" | "regionInfra";
export type ExpenseCategory = "defense" | "infra" | "social" | "edu";

export const ECONOMY_RULES = economyRulesRaw as unknown as EconomyRules;

export const PROJECT_TYPES: ProjectType[] = ["industrialComplex", "powerUnit", "regionInfra"];
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ["defense", "infra", "social", "edu"];

// — state per country

export interface ExpenseWeights {
  defense: number;
  infra: number;
  social: number;
  edu: number;
}

export interface Project {
  id: string;
  countryId: string;
  regionId: string;
  type: ProjectType;
  price: number;
  durationDays: number;
  startDay: number; // daysElapsed when started
  startDate: string;
  endDay: number;
  endDate: string;
  status: "active" | "completed";
}

export interface CountryEconomy {
  countryId: string;
  treasury: number;
  debt: number; // derived but stored explicitly for clarity: max(0, -treasury) or separate ledger? We store separate ledger; see tick logic
  gdp: number; // monthly GDP
  taxRate: number;
  weights: ExpenseWeights;
  activeProjects: Project[];
  completedProjects: Project[];
  eduHistory: number[]; // last N monthly edu spending values for lag
  lastIncome: number;
  lastExpense: number;
  lastInterest: number;
  lastGrowthRate: number;
  lastSupport: number;
  controlledRegions: Set<string>;
  lastChangeReason: string | null;
}

export interface EconomyForecast {
  cost: number;
  durationDays: number;
  slotLimitPerRegion: number;
  benefits: string[];
  risks: string[];
  unavailableReason: string | null;
  currentIncome: number;
  forecastIncome: number;
  incomeDelta: number;
  currentExpense: number;
  forecastExpense: number;
  expenseDelta: number;
  currentGrowthRate: number;
  forecastGrowthRate: number;
  currentSupport: number;
  forecastSupport: number;
  treasuryAfterCost: number;
  debtAfterCost: number;
}

export interface TaxForecast {
  oldTax: number;
  newTax: number;
  currentIncome: number;
  forecastIncome: number;
  incomeDelta: number;
  currentGrowthRate: number;
  forecastGrowthRate: number;
  growthDelta: number;
  currentSupport: number;
  forecastSupport: number;
  supportDelta: number;
  reason: string;
}

export interface WeightsForecast {
  oldWeights: ExpenseWeights;
  newWeights: ExpenseWeights;
  currentExpense: number;
  forecastExpense: number;
  expenseDelta: number;
  currentGrowthRate: number;
  forecastGrowthRate: number;
  growthDelta: number;
  currentSupport: number;
  forecastSupport: number;
  supportDelta: number;
  reason: string;
}

// — helpers

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function validateTaxRate(rate: unknown, rules: EconomyRules = ECONOMY_RULES): string | null {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "ставка налога должна быть числом";
  if (rate < rules.income.tax.min - 1e-9 || rate > rules.income.tax.max + 1e-9)
    return `ставка налога должна быть ${rules.income.tax.min}..${rules.income.tax.max}, got ${rate}`;
  // step check with epsilon
  const step = rules.income.tax.step;
  const min = rules.income.tax.min;
  const steps = Math.round((rate - min) / step);
  const expected = min + steps * step;
  if (Math.abs(rate - expected) > 1e-9) return `ставка налога должна быть кратна шагу ${step}`;
  return null;
}

export function validateWeights(w: unknown, rules: EconomyRules = ECONOMY_RULES): string | null {
  if (!w || typeof w !== "object") return "weights must be object {defense,infra,social,edu}";
  const obj = w as Record<string, unknown>;
  for (const cat of EXPENSE_CATEGORIES) {
    const v = obj[cat];
    if (typeof v !== "number" || !Number.isFinite(v)) return `вес ${cat} должен быть числом 0..1`;
    if (v < -1e-9 || v > 1 + 1e-9) return `вес ${cat} должен быть 0..1, got ${v}`;
  }
  return null;
}

export function createInitialEconomyForCountry(
  countryId: string,
  regionIds: string[],
  rules: EconomyRules = ECONOMY_RULES
): CountryEconomy {
  const weights: ExpenseWeights = { ...rules.expense.defaultWeights } as ExpenseWeights;
  const gdp = rules.gdp.baseMonthly;
  const treasury = rules.treasury.initial;
  const eduSpend = weights.edu * rules.expense.caps.edu;
  const eduHistory: number[] = [];
  // Pre-fill with default to avoid edge of empty history
  for (let i = 0; i < rules.expense.eduLagMonths; i++) eduHistory.push(eduSpend);

  const eco: CountryEconomy = {
    countryId,
    treasury,
    debt: 0,
    gdp,
    taxRate: rules.income.tax.default,
    weights,
    activeProjects: [],
    completedProjects: [],
    eduHistory,
    lastIncome: 0,
    lastExpense: 0,
    lastInterest: 0,
    lastGrowthRate: 0,
    lastSupport: rules.support.base,
    controlledRegions: new Set(regionIds),
    lastChangeReason: null,
  };
  // compute initial derived values
  eco.lastIncome = computeMonthlyIncome(eco, rules);
  eco.lastExpense = computeMonthlyExpense(eco, rules);
  eco.lastInterest = 0;
  eco.lastGrowthRate = computeGrowthRate(eco, rules);
  eco.lastSupport = computeSupport(eco, rules);
  return eco;
}

export function computeBaseExpense(weights: ExpenseWeights, rules: EconomyRules = ECONOMY_RULES): number {
  const caps = rules.expense.caps;
  return (
    weights.defense * caps.defense +
    weights.infra * caps.infra +
    weights.social * caps.social +
    weights.edu * caps.edu
  );
}

export function computeMonthlyIncome(eco: CountryEconomy, rules: EconomyRules = ECONOMY_RULES): number {
  // GDP is monthly output, income = GDP * taxRate + project bonuses from controlled regions
  // Project bonuses only counted if region is still controlled
  const controlled = eco.controlledRegions;
  let bonus = 0;
  for (const p of eco.completedProjects) {
    if (!controlled.has(p.regionId)) continue;
    // only industrial/power/infra bonuses; if uncontrolled, no bonus
    const ruleBonus = rules.projects[p.type]?.incomeBonus ?? rules.income.projectBonus[p.type] ?? 0;
    bonus += ruleBonus;
  }
  const incomeFromTax = eco.gdp * eco.taxRate;
  const total = incomeFromTax + bonus;
  return round2(total);
}

export function computeMonthlyExpense(eco: CountryEconomy, rules: EconomyRules = ECONOMY_RULES): number {
  const base = computeBaseExpense(eco.weights, rules);
  return round2(base + eco.lastInterest);
}

export function computeInterest(debt: number, rules: EconomyRules = ECONOMY_RULES): number {
  return round2(debt * rules.debt.interestRateMonthly);
}

export function computeGrowthRate(eco: CountryEconomy, rules: EconomyRules = ECONOMY_RULES): number {
  const base = rules.growth.baseRate;
  const infraEffect = eco.weights.infra * rules.growth.infraFactor;
  // edu lag: average of eduHistory normalized 0..1 * eduFactor
  const eduHistory = eco.eduHistory;
  const avgEduSpend = eduHistory.length > 0 ? sum(eduHistory) / eduHistory.length : eco.weights.edu * rules.expense.caps.edu;
  const eduNormalized = clamp(avgEduSpend / rules.expense.caps.edu, 0, 1);
  const eduEffect = eduNormalized * rules.growth.eduFactor;
  const taxPenalty = (eco.taxRate - rules.income.tax.default) * rules.income.tax.growthPenaltyFactor;
  const rate = base + infraEffect + eduEffect - taxPenalty;
  // clamp growth not too negative for sake of test stability: -0.01 .. 0.03
  return round2(clamp(rate, -0.01, 0.03));
}

export function computeSupport(eco: CountryEconomy, rules: EconomyRules = ECONOMY_RULES): number {
  const base = rules.support.base;
  const socialEffect = (eco.weights.social - 0.5) * rules.support.socialFactor;
  // tax high reduces support
  const taxEffect = (eco.taxRate - rules.income.tax.default) * rules.support.taxFactor;
  const infraEffect = (eco.weights.infra - 0.5) * rules.support.infraFactor;
  // edu lag contributes slightly
  const avgEduSpend = eco.eduHistory.length > 0 ? sum(eco.eduHistory) / eco.eduHistory.length : eco.weights.edu * rules.expense.caps.edu;
  const eduNormalized = clamp(avgEduSpend / rules.expense.caps.edu, 0, 1);
  const eduEffect = (eduNormalized - 0.5) * 6; // small

  const support = base + socialEffect - taxEffect + infraEffect + eduEffect;
  return round2(clamp(support, 0, 100));
}

// — forecast pure (no mutation)

export function forecastTaxChange(
  eco: CountryEconomy,
  newTax: number,
  rules: EconomyRules = ECONOMY_RULES
): TaxForecast {
  const currentIncome = computeMonthlyIncome(eco, rules);
  const currentGrowth = computeGrowthRate(eco, rules);
  const currentSupport = computeSupport(eco, rules);

  const tmp: CountryEconomy = { ...eco, taxRate: newTax, controlledRegions: new Set(eco.controlledRegions), activeProjects: [...eco.activeProjects], completedProjects: [...eco.completedProjects], eduHistory: [...eco.eduHistory], weights: { ...eco.weights } };
  const forecastIncome = computeMonthlyIncome(tmp, rules);
  const forecastGrowth = computeGrowthRate(tmp, rules);
  const forecastSupport = computeSupport(tmp, rules);

  let reason = "";
  if (newTax > eco.taxRate) {
    reason = `Налог повышен с ${(eco.taxRate * 100).toFixed(0)}% до ${(newTax * 100).toFixed(0)}%: доход сейчас +${(forecastIncome - currentIncome).toFixed(2)}, но рост ${(forecastGrowth * 100).toFixed(2)}% vs ${(currentGrowth * 100).toFixed(2)}% и поддержка ${forecastSupport.toFixed(1)} vs ${currentSupport.toFixed(1)} снижаются`;
  } else if (newTax < eco.taxRate) {
    reason = `Налог снижен с ${(eco.taxRate * 100).toFixed(0)}% до ${(newTax * 100).toFixed(0)}%: доход сейчас ${(forecastIncome - currentIncome).toFixed(2)}, зато рост и поддержка растут`;
  } else {
    reason = "Налог без изменений";
  }

  return {
    oldTax: eco.taxRate,
    newTax,
    currentIncome,
    forecastIncome,
    incomeDelta: round2(forecastIncome - currentIncome),
    currentGrowthRate: currentGrowth,
    forecastGrowthRate: forecastGrowth,
    growthDelta: round2(forecastGrowth - currentGrowth),
    currentSupport,
    forecastSupport,
    supportDelta: round2(forecastSupport - currentSupport),
    reason,
  };
}

export function forecastWeightsChange(
  eco: CountryEconomy,
  newWeights: ExpenseWeights,
  rules: EconomyRules = ECONOMY_RULES
): WeightsForecast {
  const currentExpense = computeBaseExpense(eco.weights, rules) + eco.lastInterest;
  const forecastBaseExpense = computeBaseExpense(newWeights, rules) + eco.lastInterest;
  const currentGrowth = computeGrowthRate(eco, rules);
  const currentSupport = computeSupport(eco, rules);

  const tmp: CountryEconomy = { ...eco, weights: { ...newWeights }, controlledRegions: new Set(eco.controlledRegions), activeProjects: [...eco.activeProjects], completedProjects: [...eco.completedProjects], eduHistory: [...eco.eduHistory], taxRate: eco.taxRate };
  // for forecast we keep eduHistory as is (lag), but weights reflect new edu spending for future
  // Growth forecast currently uses old eduHistory, so immediate edu effect is lagged - reflects design
  // To show future edu effect, we could show that edu change affects future growth, not immediate
  const forecastGrowth = computeGrowthRate(tmp, rules);
  const forecastSupport = computeSupport(tmp, rules);

  let reason = `Веса: оборона ${(newWeights.defense * 100).toFixed(0)}% (было ${(eco.weights.defense * 100).toFixed(0)}%), инфра ${(newWeights.infra * 100).toFixed(0)}%, соц ${(newWeights.social * 100).toFixed(0)}%, наука ${(newWeights.edu * 100).toFixed(0)}%. Расход ${forecastBaseExpense.toFixed(2)} vs ${currentExpense.toFixed(2)}. `;
  if (newWeights.infra > eco.weights.infra) reason += "Инфра ↑ ускоряет рост. ";
  if (newWeights.edu > eco.weights.edu) reason += "Наука ↑ с лагом ~6 мес. даст рост. ";
  if (newWeights.social > eco.weights.social) reason += "Соц ↑ повышает поддержку. ";
  if (newWeights.defense > eco.weights.defense) reason += "Оборона ↑ — армию в T5 будет дешевле содержать, но отнимает от развития. ";

  return {
    oldWeights: { ...eco.weights },
    newWeights: { ...newWeights },
    currentExpense: round2(currentExpense),
    forecastExpense: round2(forecastBaseExpense),
    expenseDelta: round2(forecastBaseExpense - currentExpense),
    currentGrowthRate: currentGrowth,
    forecastGrowthRate: forecastGrowth,
    growthDelta: round2(forecastGrowth - currentGrowth),
    currentSupport,
    forecastSupport,
    supportDelta: round2(forecastSupport - currentSupport),
    reason,
  };
}

export function forecastProject(
  eco: CountryEconomy,
  type: ProjectType,
  regionId: string,
  rules: EconomyRules = ECONOMY_RULES,
  regionController?: Map<string, string>
): EconomyForecast {
  const rule = rules.projects[type];
  if (!rule) {
    return {
      cost: 0,
      durationDays: 0,
      slotLimitPerRegion: 0,
      benefits: [],
      risks: ["неизвестный тип проекта"],
      unavailableReason: `неизвестный тип проекта: ${type}`,
      currentIncome: computeMonthlyIncome(eco, rules),
      forecastIncome: computeMonthlyIncome(eco, rules),
      incomeDelta: 0,
      currentExpense: computeMonthlyExpense(eco, rules),
      forecastExpense: computeMonthlyExpense(eco, rules),
      expenseDelta: 0,
      currentGrowthRate: computeGrowthRate(eco, rules),
      forecastGrowthRate: computeGrowthRate(eco, rules),
      currentSupport: computeSupport(eco, rules),
      forecastSupport: computeSupport(eco, rules),
      treasuryAfterCost: eco.treasury,
      debtAfterCost: eco.debt,
    };
  }

  const cost = rule.price;
  const durationDays = rule.durationDays;
  const slotLimit = rule.slotLimitPerRegion;

  const currentIncome = computeMonthlyIncome(eco, rules);
  const currentExpense = computeMonthlyExpense(eco, rules);
  const currentGrowth = computeGrowthRate(eco, rules);
  const currentSupport = computeSupport(eco, rules);

  // check unavailable reasons
  let unavailable: string | null = null;

  // region must be controlled by this country
  if (!eco.controlledRegions.has(regionId)) {
    unavailable = `регион ${regionId} не под вашим контролем (потерян или оккупирован)`;
  }

  // also if regionController map supplied, double-check
  if (regionController && regionController.get(regionId) !== eco.countryId) {
    // if controller mismatches, also unavailable – but already covered by controlledRegions; keep precise message
    if (!unavailable) unavailable = `регион ${regionId} контролирует ${regionController.get(regionId) ?? "неизвестно"}, а не вы`;
  }

  // slot limit: active + completed in region
  const countInRegion =
    eco.activeProjects.filter((p) => p.regionId === regionId).length +
    eco.completedProjects.filter((p) => p.regionId === regionId).length;
  if (countInRegion >= slotLimit) {
    unavailable = `в регионе ${regionId} нет свободных слотов: занято ${countInRegion}/${slotLimit} (лимит ${slotLimit} на регион в A)`;
  }

  // treasury check: need to warn but not block? Spec says forecast shows why unavailable, and deduct price from treasury. If not enough money, we still allow but go into debt with risk.
  // So we won't block on treasury, but will add risk about debt.
  const treasuryAfterCost = round2(eco.treasury - cost);
  const debtAfterCost = treasuryAfterCost < 0 ? round2(-treasuryAfterCost + eco.debt) : eco.debt; // if treasury negative, debt increases. Simpler: debt reflects negative treasury. But we keep separate debt ledger: if treasury would go negative, debt increases.
  // For forecast, approximate.

  // benefits
  const benefits: string[] = [];
  benefits.push(`+${rule.incomeBonus} к месячному доходу после завершения`);
  benefits.push(`+${rule.gdpBonus} к месячному ВВП`);
  if (type === "industrialComplex") benefits.push("Сильно повышает доход; потеря такого региона ощутимо бьёт по бюджету (тест потери)");
  if (type === "powerUnit") benefits.push("Стабильный прирост энергии для промышленности");
  if (type === "regionInfra") benefits.push("Ускоряет логистику региона");

  const risks: string[] = [];
  risks.push(rule.riskRu);
  if (treasuryAfterCost < 0) risks.push(`Уйдёте в долг: казна ${treasuryAfterCost.toFixed(2)}, долг + проценты ${(debtAfterCost * rules.debt.interestRateMonthly).toFixed(2)}/мес`);
  if (type === "industrialComplex" && eco.treasury < cost)
    risks.push("Дорогой проект — риск дефицита и процентов по долгу");
  if (countInRegion + 1 === slotLimit) risks.push("После этого слота регион будет заполнен");

  // forecast income after completion
  const forecastEco: CountryEconomy = {
    ...eco,
    controlledRegions: new Set(eco.controlledRegions),
    activeProjects: [...eco.activeProjects],
    completedProjects: [
      ...eco.completedProjects,
      {
        id: "forecast",
        countryId: eco.countryId,
        regionId,
        type,
        price: rule.price,
        durationDays: rule.durationDays,
        startDay: 0,
        startDate: "2026-01-01",
        endDay: rule.durationDays,
        endDate: addDays("2026-01-01", rule.durationDays),
        status: "completed",
      } as Project,
    ],
    eduHistory: [...eco.eduHistory],
    weights: { ...eco.weights },
  };
  const forecastIncome = computeMonthlyIncome(forecastEco, rules);
  // For growth, GDP bonus adds to gdp
  const forecastGdp = eco.gdp + rule.gdpBonus;
  const forecastGrowthEco = { ...forecastEco, gdp: forecastGdp };
  const forecastGrowth = computeGrowthRate(forecastGrowthEco, rules);
  const forecastSupport = computeSupport(forecastEco, rules);

  return {
    cost,
    durationDays,
    slotLimitPerRegion: slotLimit,
    benefits,
    risks,
    unavailableReason: unavailable,
    currentIncome,
    forecastIncome,
    incomeDelta: round2(forecastIncome - currentIncome),
    currentExpense,
    forecastExpense: currentExpense, // construction cost is one-time, not monthly expense, so no delta
    expenseDelta: 0,
    currentGrowthRate: currentGrowth,
    forecastGrowthRate: forecastGrowth,
    currentSupport,
    forecastSupport,
    treasuryAfterCost,
    debtAfterCost,
  };
}

// — monthly tick processor

export function processMonthlyTick(
  eco: CountryEconomy,
  rules: EconomyRules = ECONOMY_RULES
): { income: number; expense: number; interest: number; net: number; growthRate: number; support: number; gdpBefore: number; gdpAfter: number } {
  const gdpBefore = eco.gdp;

  // compute growth based on current weights and tax and edu lag
  const growthRate = computeGrowthRate(eco, rules);
  // update GDP
  const gdpAfter = round2(eco.gdp * (1 + growthRate));
  eco.gdp = gdpAfter;
  eco.lastGrowthRate = growthRate;

  // compute income after GDP update (so growth affects income same month slightly)
  const income = computeMonthlyIncome(eco, rules);
  eco.lastIncome = income;

  // interest based on previous debt
  const interest = computeInterest(eco.debt, rules);
  eco.lastInterest = interest;

  // base expense + interest
  const baseExpense = computeBaseExpense(eco.weights, rules);
  const expense = round2(baseExpense + interest);
  eco.lastExpense = expense;

  const net = round2(income - expense);
  eco.lastSupport = computeSupport(eco, rules);

  // update treasury / debt
  // We keep debt as separate ledger; treasury can go to zero and debt grows.
  // Logic: if net positive: first repay debt, then add to treasury
  // if net negative: consume treasury, then borrow to debt
  if (net >= 0) {
    if (eco.debt > 0) {
      const repay = Math.min(eco.debt, net);
      eco.debt = round2(eco.debt - repay);
      const remaining = round2(net - repay);
      eco.treasury = round2(eco.treasury + remaining);
    } else {
      eco.treasury = round2(eco.treasury + net);
    }
  } else {
    // deficit
    const deficit = -net;
    if (eco.treasury >= deficit) {
      eco.treasury = round2(eco.treasury - deficit);
    } else {
      const remainingDeficit = round2(deficit - eco.treasury);
      eco.treasury = 0;
      eco.debt = round2(eco.debt + remainingDeficit);
    }
  }

  // update eduHistory: push current edu spending, keep last N
  const eduSpend = eco.weights.edu * rules.expense.caps.edu;
  eco.eduHistory.push(eduSpend);
  if (eco.eduHistory.length > rules.expense.eduLagMonths) eco.eduHistory.shift();

  return { income, expense, interest, net, growthRate, support: eco.lastSupport, gdpBefore, gdpAfter };
}
