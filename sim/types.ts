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
