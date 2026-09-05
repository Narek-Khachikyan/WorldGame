import { describe, it, expect } from "vitest";
import { TimeAccumulator, TIME_SPEEDS, DEFAULT_SPEED, getDaysPerSecond, TIME_CONFIG } from "../time.js";

describe("rules/time.json speeds", () => {
  it("contains 1/3/7 and baseStep 1", () => {
    expect(TIME_SPEEDS.slow).toBe(1);
    expect(TIME_SPEEDS.normal).toBe(3);
    expect(TIME_SPEEDS.fast).toBe(7);
    expect(TIME_CONFIG.baseStepDays).toBe(1);
    expect(TIME_CONFIG.speeds.slow).toBe(1);
    expect(TIME_CONFIG.speeds.normal).toBe(3);
    expect(TIME_CONFIG.speeds.fast).toBe(7);
  });

  it("default is normal", () => {
    expect(DEFAULT_SPEED).toBe("normal");
    expect(getDaysPerSecond("normal")).toBe(3);
    expect(getDaysPerSecond("slow")).toBe(1);
    expect(getDaysPerSecond("fast")).toBe(7);
    expect(getDaysPerSecond("paused")).toBe(0);
  });
});

describe("TimeAccumulator fixed-timestep", () => {
  it("paused yields 0", () => {
    const acc = new TimeAccumulator("paused");
    expect(acc.advance(10)).toBe(0);
    expect(acc.advance(0)).toBe(0);
  });

  it("slow 1 day/sec, normal 3, fast 7", () => {
    const slow = new TimeAccumulator("slow");
    expect(slow.advance(1)).toBe(1);
    const normal = new TimeAccumulator("normal");
    expect(normal.advance(1)).toBe(3);
    const fast = new TimeAccumulator("fast");
    expect(fast.advance(1)).toBe(7);
  });

  it("accumulates fractions correctly", () => {
    const acc = new TimeAccumulator("normal"); // 3 d/s
    // 0.1s *3 =0.3 -> 0 days remainder 0.3
    expect(acc.advance(0.1)).toBe(0);
    expect(acc.getRemainder()).toBeCloseTo(0.3, 5);
    // another 0.1 -> 0.6 ->0
    expect(acc.advance(0.1)).toBe(0);
    // 0.2 -> acc 1.2 ->1 day remainder 0.2
    expect(acc.advance(0.2)).toBe(1);
    expect(acc.getRemainder()).toBeCloseTo(0.2, 5);
  });

  it("frame-rate invariance: same total seconds => same total days regardless of slicing", () => {
    const totalSec = 10;
    // slow: 1 d/s => 10 days
    const a = new TimeAccumulator("slow");
    const b = new TimeAccumulator("slow");
    const daysA = a.advance(totalSec); // one chunk
    // slice into many small frames
    let daysB = 0;
    for (let i = 0; i < 100; i++) daysB += b.advance(totalSec / 100);
    expect(daysA).toBe(10);
    expect(daysB).toBe(10);
    expect(a.getRemainder()).toBeCloseTo(b.getRemainder(), 9);

    // normal: 3 d/s => 30 days sliced vs not
    const c = new TimeAccumulator("normal");
    const d = new TimeAccumulator("normal");
    const daysC = c.advance(5); // 15
    let daysD = 0;
    for (let i = 0; i < 50; i++) daysD += d.advance(0.1); // 50*0.1=5s
    expect(daysC).toBe(daysD);
    expect(daysC).toBe(15);

    // fast with irregular slicing
    const e = new TimeAccumulator("fast");
    const f = new TimeAccumulator("fast");
    const deltas = [0.016, 0.033, 0.016, 0.1, 0.25, 0.5, 1.2];
    const total = deltas.reduce((s, v) => s + v, 0);
    let eDays = 0;
    for (const dt of deltas) eDays += e.advance(dt);
    const fDays = f.advance(total);
    expect(eDays).toBe(fDays);
  });

  it("speed change keeps remainder (no day loss)", () => {
    const acc = new TimeAccumulator("slow");
    acc.advance(0.5); // 0.5 days, 0 days, rem 0.5
    expect(acc.advance(0)).toBe(0);
    acc.setSpeed("fast"); // 7 d/s
    // next 0.5s at fast => 3.5 + 0.5 rem =4.0 =>4 days
    expect(acc.advance(0.5)).toBe(4);
  });

  it("rejects negative delta", () => {
    const acc = new TimeAccumulator("normal");
    expect(() => acc.advance(-1)).toThrow();
  });

  it("pause/resume via setSpeed", () => {
    const acc = new TimeAccumulator("normal");
    acc.setSpeed("paused");
    expect(acc.isPaused).toBe(true);
    expect(acc.advance(1)).toBe(0);
    acc.setSpeed("normal");
    expect(acc.isPaused).toBe(false);
    expect(acc.advance(1)).toBe(3);
  });
});
