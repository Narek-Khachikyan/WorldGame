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

export interface SimSnapshot {
  date: GameDateString;
  daysElapsed: number;
  seed: number;
  tickCount: number;
  customState: Record<string, number>;
  // T4 economy snapshot (if engine has economy)
  economies?: Record<string, { treasury: number; debt: number; gdp: number; taxRate: number; weights: Record<string, number>; lastIncome: number; lastExpense: number; lastInterest: number; lastGrowthRate: number; lastSupport: number }>;
  projects?: Array<{ id: string; countryId: string; regionId: string; type: string; status: string; startDate: string; endDate: string }>;
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
