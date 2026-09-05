/**
 * Seeded RNG — mulberry32. Seed stored for reproducibility.
 * Deterministic: same seed => same sequence.
 */

export class SeededRng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    // ensure unsigned 32-bit
    this.seed = seed >>> 0;
    this.state = seed >>> 0;
  }

  /** Next float in [0,1). Advances state. */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (min > max) throw new Error(`nextInt min>max ${min}>${max}`);
    const r = this.next();
    return Math.floor(r * (max - min + 1)) + min;
  }

  /** Float in [min, max). */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Clone with same current state (for testing). */
  clone(): SeededRng {
    const c = new SeededRng(this.seed);
    c.state = this.state;
    return c;
  }

  /** Snapshot state for save/load. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

export function createRng(seed: number): SeededRng {
  return new SeededRng(seed);
}
