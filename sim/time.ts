import timeConfigJson from "../rules/time.json";
import type { Speed, TimeSpeedConfig } from "./types.js";

export const TIME_CONFIG: TimeSpeedConfig = timeConfigJson as TimeSpeedConfig;

export const TIME_SPEEDS: Record<Exclude<Speed, "paused">, number> = {
  slow: TIME_CONFIG.speeds.slow,
  normal: TIME_CONFIG.speeds.normal,
  fast: TIME_CONFIG.speeds.fast,
};

export const DEFAULT_SPEED: Speed = TIME_CONFIG.defaultSpeed as Speed;
export const BASE_STEP_DAYS = TIME_CONFIG.baseStepDays as number;

export function getDaysPerSecond(speed: Speed): number {
  if (speed === "paused") return 0;
  const v = TIME_SPEEDS[speed as Exclude<Speed, "paused">];
  if (v === undefined) throw new Error(`unknown speed ${speed}`);
  return v;
}

/**
 * Fixed-timestep accumulator.
 * Accumulates real seconds * daysPerSecond into whole game days.
 * Frame rate does not affect total days — only how they are sliced.
 */
export class TimeAccumulator {
  private acc = 0;
  private _speed: Speed;

  constructor(initialSpeed: Speed = DEFAULT_SPEED) {
    this._speed = initialSpeed;
  }

  get speed(): Speed {
    return this._speed;
  }

  setSpeed(s: Speed): void {
    if (s !== "paused" && !(s in TIME_SPEEDS)) {
      throw new Error(`unknown speed ${s}`);
    }
    this._speed = s;
  }

  get isPaused(): boolean {
    return this._speed === "paused";
  }

  /** Returns integer days to tick for this frame. Keeps fractional remainder. */
  advance(deltaSeconds: number): number {
    if (deltaSeconds < 0) throw new Error(`deltaSeconds must be >=0, got ${deltaSeconds}`);
    if (this.isPaused || deltaSeconds === 0) return 0;
    const dps = getDaysPerSecond(this._speed);
    this.acc += deltaSeconds * dps;
    // mitigate floating error: floor with epsilon
    const days = Math.floor(this.acc + 1e-9);
    this.acc -= days;
    // clamp tiny negative due to fp
    if (this.acc < 0 && this.acc > -1e-9) this.acc = 0;
    return days;
  }

  /** For testing: peek remainder. */
  getRemainder(): number {
    return this.acc;
  }

  reset(): void {
    this.acc = 0;
  }

  /** For save/load of accumulator remainder (determinism). */
  getState(): { acc: number; speed: Speed } {
    return { acc: this.acc, speed: this._speed };
  }

  setState(s: { acc: number; speed: Speed }): void {
    this.acc = s.acc;
    this._speed = s.speed;
  }
}
