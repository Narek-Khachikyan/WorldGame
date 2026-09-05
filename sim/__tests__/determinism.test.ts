import { describe, it, expect } from "vitest";
import { createSim } from "../engine.js";
import { TimeAccumulator } from "../time.js";

/**
 * Acceptance: same seed + same command sequence => same result
 * Also: pause/3 speeds via fixed-timestep don't change sim result for same days
 */

describe("determinism", () => {
  function runScenario(seed: number, cmds: Array<{ type: string; payload?: unknown; atDay: number }>, totalDays: number) {
    const sim = createSim({ seed });
    let nextCmdIdx = 0;
    // sort by atDay
    cmds.sort((a, b) => a.atDay - b.atDay);
    for (let day = 0; day < totalDays; day++) {
      while (nextCmdIdx < cmds.length && cmds[nextCmdIdx].atDay === day) {
        const c = cmds[nextCmdIdx];
        sim.dispatch({ type: c.type, payload: c.payload });
        nextCmdIdx++;
      }
      sim.tick(1);
    }
    // remaining cmds at totalDays
    while (nextCmdIdx < cmds.length) {
      const c = cmds[nextCmdIdx];
      sim.dispatch({ type: c.type, payload: c.payload });
      nextCmdIdx++;
    }
    return sim.getSnapshot();
  }

  it("same seed + same commands => identical snapshot and eventLog", () => {
    const seed = 2026;
    const cmds = [
      { type: "incrementCounter", payload: { key: "gold", delta: 10 }, atDay: 0 },
      { type: "testPing", payload: { message: "hi" }, atDay: 1 },
      { type: "incrementCounter", payload: { key: "gold", delta: -3 }, atDay: 5 },
      { type: "incrementCounter", payload: { key: "xp", delta: 42 }, atDay: 10 },
    ];
    const a = runScenario(seed, [...cmds], 30);
    const b = runScenario(seed, [...cmds], 30);
    expect(a).toEqual(b);

    // also compare event log via fresh sims
    const simA = createSim({ seed });
    const simB = createSim({ seed });
    for (const c of cmds) {
      simA.dispatch({ type: c.type, payload: c.payload });
      simB.dispatch({ type: c.type, payload: c.payload });
    }
    simA.tick(20);
    simB.tick(20);
    expect(simA.getEventLog()).toEqual(simB.getEventLog());
    expect(simA.getSnapshot()).toEqual(simB.getSnapshot());
  });

  it("different seed => different result (with rng-consuming commands)", () => {
    const cmds = [{ type: "incrementCounter", payload: { key: "k", delta: 1 }, atDay: 0 }];
    const a = runScenario(1, [...cmds], 10);
    const b = runScenario(2, [...cmds], 10);
    // customState same (deterministic delta), but rng state differs, so eventLog rng payload differs
    // we check that the underlying rng states diverge, leading to different eventLog entries for incrementCounter
    const simA = createSim({ seed: 1 });
    const simB = createSim({ seed: 2 });
    simA.dispatch({ type: "incrementCounter", payload: { key: "k", delta: 1 } });
    simB.dispatch({ type: "incrementCounter", payload: { key: "k", delta: 1 } });
    const logA = simA.getEventLog().find((e) => e.kind === "incrementCounter");
    const logB = simB.getEventLog().find((e) => e.kind === "incrementCounter");
    expect((logA?.payload as { rng: number })?.rng).not.toBe((logB?.payload as { rng: number })?.rng);
    // snapshots customState equal but tick-induced rng would still diverge on longer run — ensure not falsely equal
    expect(a.seed).not.toBe(b.seed);
  });

  it("same total days via different tick chunking => same date and same snapshot", () => {
    const simA = createSim({ seed: 999 });
    const simB = createSim({ seed: 999 });
    // A: tick 30 in one go
    simA.tick(30);
    // B: tick 1 thirty times
    for (let i = 0; i < 30; i++) simB.tick(1);
    expect(simA.getDate()).toBe(simB.getDate());
    expect(simA.getDaysElapsed()).toBe(simB.getDaysElapsed());
    expect(simA.getSnapshot()).toEqual(simB.getSnapshot());
    expect(simA.getEventLog()).toEqual(simB.getEventLog());
  });

  it("pause + 3 speeds via fixed-timestep don't change sim result for same game days", () => {
    // Simulate real time -> game days conversion under different frame patterns, then compare sim state
    const seed = 777;
    const totalGameDays = 21; // 3 weeks

    // helper: how many real seconds needed at given speed to produce N game days
    // days = seconds * dps  => seconds = days / dps
    function produceDaysViaAccumulator(speed: "slow" | "normal" | "fast", days: number, frameSplit: number[]): number {
      const acc = new TimeAccumulator(speed);
      let totalDays = 0;
      // if frameSplit provided, use it to slice total seconds; otherwise 60fps approx
      if (frameSplit.length === 0) {
        const totalSec = days / ({ slow: 1, normal: 3, fast: 7 }[speed]);
        totalDays += acc.advance(totalSec);
      } else {
        for (const dt of frameSplit) totalDays += acc.advance(dt);
      }
      return totalDays;
    }

    // All three speeds should be able to produce same game days when run for appropriate real time
    const secSlow = totalGameDays / 1;
    const secNormal = totalGameDays / 3;
    const secFast = totalGameDays / 7;

    const accSlow = new TimeAccumulator("slow");
    const accNormal = new TimeAccumulator("normal");
    const accFast = new TimeAccumulator("fast");
    const slowDays = accSlow.advance(secSlow);
    const normalDays = accNormal.advance(secNormal);
    const fastDays = accFast.advance(secFast);
    expect(slowDays).toBe(totalGameDays);
    expect(normalDays).toBe(totalGameDays);
    expect(fastDays).toBe(totalGameDays);

    // Now apply those days to sims — result must be identical date
    const simSlow = createSim({ seed });
    const simNormal = createSim({ seed });
    const simFast = createSim({ seed });
    simSlow.tick(slowDays);
    simNormal.tick(normalDays);
    simFast.tick(fastDays);
    expect(simSlow.getDate()).toBe(simNormal.getDate());
    expect(simNormal.getDate()).toBe(simFast.getDate());
    expect(simSlow.getSnapshot()).toEqual(simNormal.getSnapshot());
    expect(simNormal.getSnapshot()).toEqual(simFast.getSnapshot());

    // Also test frame-rate invariance: same speed, different frame slicing => same sim result
    const simA = createSim({ seed });
    const simB = createSim({ seed });
    const accA = new TimeAccumulator("normal");
    const accB = new TimeAccumulator("normal");
    const totalSec = totalGameDays / 3; // normal 3 d/s
    const daysA = accA.advance(totalSec); // one chunk
    let daysB = 0;
    // slice into 0.016s frames (~60fps) plus some jitter
    const frames = Array.from({ length: Math.ceil(totalSec / 0.016) }, (_, i) => (i < Math.ceil(totalSec / 0.016) - 1 ? 0.016 : totalSec - 0.016 * (Math.ceil(totalSec / 0.016) - 1)));
    for (const dt of frames) daysB += accB.advance(dt);
    // fallback: ensure totals equal (accumulator guarantees)
    expect(daysA).toBe(daysB);
    simA.tick(daysA);
    simB.tick(daysB);
    expect(simA.getSnapshot()).toEqual(simB.getSnapshot());
  });

  it("command sequence before and after tick is order-sensitive and deterministic", () => {
    const seed = 31415;
    const simA = createSim({ seed });
    simA.dispatch({ type: "incrementCounter", payload: { key: "c", delta: 5 } });
    simA.tick(10);
    simA.dispatch({ type: "incrementCounter", payload: { key: "c", delta: 7 } });
    simA.tick(5);

    const simB = createSim({ seed });
    simB.dispatch({ type: "incrementCounter", payload: { key: "c", delta: 5 } });
    simB.tick(10);
    simB.dispatch({ type: "incrementCounter", payload: { key: "c", delta: 7 } });
    simB.tick(5);

    expect(simA.getSnapshot()).toEqual(simB.getSnapshot());
    expect(simA.getCustomState().c).toBe(12);
    expect(simB.getCustomState().c).toBe(12);

    // different order => different rng consumption order => eventLog differs (but still deterministic)
    const simC = createSim({ seed });
    simC.tick(10);
    simC.dispatch({ type: "incrementCounter", payload: { key: "c", delta: 5 } });
    simC.dispatch({ type: "incrementCounter", payload: { key: "c", delta: 7 } });
    simC.tick(5);
    // customState same total delta, but rng payloads differ because tick rng interleaves differently
    expect(simC.getCustomState().c).toBe(12);
    // snapshot tickCount same, but eventLog not equal due to rng values
    expect(simA.getEventLog()).not.toEqual(simC.getEventLog());
  });
});
