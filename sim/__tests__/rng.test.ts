import { describe, it, expect } from "vitest";
import { SeededRng, createRng } from "../rng.js";

describe("seeded RNG (mulberry32)", () => {
  it("same seed => same sequence", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds => different first value (high probability)", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("nextInt respects range", () => {
    const rng = createRng(99);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it("clone preserves state", () => {
    const rng = createRng(777);
    rng.next();
    rng.next();
    const clone = rng.clone();
    expect(rng.next()).toBe(clone.next());
    expect(rng.next()).toBe(clone.next());
  });

  it("state snapshot roundtrip", () => {
    const rng = createRng(555);
    const v1 = rng.next();
    const state = rng.getState();
    const rng2 = createRng(555);
    rng2.setState(state);
    expect(rng2.next()).toBe(rng.next());
    // ensure v1 was deterministic
    const rng3 = createRng(555);
    expect(rng3.next()).toBe(v1);
  });

  it("seed stored for reproducibility", () => {
    const rng = new SeededRng(2026);
    expect(rng.seed).toBe(2026);
  });
});
