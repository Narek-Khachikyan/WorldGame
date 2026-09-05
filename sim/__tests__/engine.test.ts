import { describe, it, expect } from "vitest";
import { createSim, SimEngine } from "../engine.js";
import { START_DATE } from "../calendar.js";

describe("SimEngine core", () => {
  it("ticks days from 01.01.2026", () => {
    const sim = createSim({ seed: 1 });
    expect(sim.getDate()).toBe(START_DATE);
    expect(sim.getDate()).toBe("2026-01-01");
    expect(sim.getDaysElapsed()).toBe(0);
    sim.tick(1);
    expect(sim.getDate()).toBe("2026-01-02");
    sim.tick(30);
    expect(sim.getDate()).toBe("2026-02-01");
    expect(sim.getDaysElapsed()).toBe(31);
  });

  it("tick(0) is no-op, negative throws", () => {
    const sim = createSim({ seed: 1 });
    sim.tick(0);
    expect(sim.getDate()).toBe("2026-01-01");
    expect(() => sim.tick(-1)).toThrow();
    expect(() => sim.tick(1.5 as unknown as number)).toThrow();
  });

  it("stores seed and uses it deterministically", () => {
    const sim = createSim({ seed: 123 });
    expect(sim.getSeed()).toBe(123);
    expect(sim.getSnapshot().seed).toBe(123);
  });

  it("dispatch validates and rejects with reason, logs rejection", () => {
    const sim = createSim({ seed: 10 });
    const before = sim.getEventLog().length;
    const r = sim.dispatch({ type: "unknownFoo" } as unknown as { type: string });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    const after = sim.getEventLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].kind).toBe("commandRejected");
  });

  it("dispatch accepts known commands and appends to log", () => {
    const sim = createSim({ seed: 10 });
    const r1 = sim.dispatch({ type: "noop" });
    expect(r1.ok).toBe(true);
    const r2 = sim.dispatch({ type: "testPing", payload: { message: "hello" } });
    expect(r2.ok).toBe(true);
    const log = sim.getEventLog();
    expect(log.some((e) => e.kind === "testPing")).toBe(true);
  });

  it("incrementCounter mutates customState deterministically and consumes RNG", () => {
    const sim = createSim({ seed: 42 });
    sim.dispatch({ type: "incrementCounter", payload: { key: "a", delta: 5 } });
    expect(sim.getCustomState().a).toBe(5);
    sim.dispatch({ type: "incrementCounter", payload: { key: "a", delta: 3 } });
    expect(sim.getCustomState().a).toBe(8);
    // rng has advanced per command
    expect(sim.getRngState()).not.toBe(42);
  });

  it("eventLog is readable via queries", () => {
    const sim = createSim({ seed: 1 });
    sim.dispatch({ type: "noop" });
    sim.tick(1);
    expect(sim.getEventLog().length).toBeGreaterThan(0);
    expect(sim.getEventLogTail(1).length).toBe(1);
    expect(sim.getSnapshot().date).toBe(sim.getDate());
    expect(sim.getSnapshot().daysElapsed).toBe(sim.getDaysElapsed());
  });

  it("custom startDate", () => {
    const sim = createSim({ seed: 1, startDate: "2026-06-15" });
    expect(sim.getDate()).toBe("2026-06-15");
    sim.tick(1);
    expect(sim.getDate()).toBe("2026-06-16");
  });

  it("tick increments tickCount", () => {
    const sim = new SimEngine({ seed: 1 });
    expect(sim.getTickCount()).toBe(0);
    sim.tick(5);
    expect(sim.getTickCount()).toBe(5);
    expect(sim.getDaysElapsed()).toBe(5);
  });
});
