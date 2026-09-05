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

export interface WarSnapshot {
  warId: string;
  attackerId: string;
  defenderId: string;
  startDay: number;
  startDate: string;
  status: "active" | "ended";
  endDay?: number;
  endDate?: string;
  endReason?: string;
  exhaustionAttacker: number;
  exhaustionDefender: number;
  daysAtWar: number;
  occupiedByAttacker: string[];
  occupiedByDefender: string[];
}

export interface PoliticalStateSnapshot {
  countryId: string;
  regime: string;
  leaderId: string;
  leaderTitle: string;
  partyId: string;
  stability: number;
  support: number;
  warFatigueLite: number;
  nextElectionDate: string;
  regimeCooldownUntil: string | null;
  pendingRegimeChange: { newRegime: string; effectiveDay: number; effectiveDate: string } | null;
  crisisLevel: number;
  lastElectionDate: string | null;
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
  // T6 war
  wars?: WarSnapshot[];
  threats?: Record<string, number>;
  // T7 politics
  politics?: {
    states: Record<string, PoliticalStateSnapshot>;
    relations: Record<string, number>;
    trust: Record<string, number>;
  };
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
