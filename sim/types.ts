/** Shared sim types — pure TS, no React. Skeleton for T1. */

export type GameDateString = string; // YYYY-MM-DD

export interface SimConfig {
  seed?: number;
  startDate?: GameDateString;
}

export interface Command {
  type: string;
  payload?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface SimEvent {
  id: number;
  date: GameDateString;
  kind: string;
  payload?: unknown;
  message?: string;
}

export interface RegionControllerState {
  regionId: string;
  ownerId: string;
  controllerId: string;
  terrain: string;
  fortLevel: number;
  isCapitalRegion: boolean;
}

export interface CountryEconomyState {
  treasury: number;
  population: number;
  equipmentStock: number;
}

export interface ArmyUnitSnapshot {
  unitId: string;
  countryId: string;
  regionId: string;
  personnel: number;
  equipment: number;
  readiness: number;
  stance: string;
  daysUntilReady: number;
  hiringTimeDays: number;
}

export interface SimSnapshot {
  date: GameDateString;
  daysElapsed: number;
  seed: number;
  tickCount: number;
  customState: Record<string, number>;
  // T4 economy snapshot (if engine has economy)
  economies?: Record<string, { treasury: number; debt: number; gdp: number; taxRate: number; weights: Record<string, number>; lastIncome: number; lastExpense: number; lastInterest: number; lastGrowthRate: number; lastSupport: number }>;
  projects?: Array<{ id: string; countryId: string; regionId: string; type: string; status: string; startDate: string; endDate: string }>;
  // T5 army — exposed for map UI military layer (#4) and tests; owner vs controller contract: owner only changed by peace (T6)
  units?: ArmyUnitSnapshot[];
  regions?: RegionControllerState[];
  countryEconomy?: Record<string, CountryEconomyState>;
}

export type Speed = "slow" | "normal" | "fast" | "paused";

export interface TimeSpeedConfig {
  speeds: {
    slow: number;
    normal: number;
    fast: number;
  };
  defaultSpeed: Speed;
  baseStepDays: number;
}
