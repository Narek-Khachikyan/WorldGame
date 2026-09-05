import { describe, it, expect } from "vitest";
import { EventLog } from "../eventLog.js";

describe("eventLog skeleton", () => {
  it("appends and orders events", () => {
    const log = new EventLog();
    log.append("2026-01-01", "a", { x: 1 });
    log.append("2026-01-02", "b", { y: 2 }, "hello");
    const all = log.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe(1);
    expect(all[1].id).toBe(2);
    expect(all[0].kind).toBe("a");
    expect(all[1].message).toBe("hello");
  });

  it("getTail returns last N", () => {
    const log = new EventLog();
    for (let i = 0; i < 5; i++) log.append("2026-01-01", "k" + i);
    expect(log.getTail(2).map((e) => e.kind)).toEqual(["k3", "k4"]);
    expect(log.getTail(0)).toEqual([]);
    expect(log.getTail(10)).toHaveLength(5);
  });

  it("getByKind filters", () => {
    const log = new EventLog();
    log.append("2026-01-01", "foo");
    log.append("2026-01-01", "bar");
    log.append("2026-01-01", "foo");
    expect(log.getByKind("foo")).toHaveLength(2);
  });

  it("clear resets", () => {
    const log = new EventLog();
    log.append("2026-01-01", "x");
    log.clear();
    expect(log.size).toBe(0);
    expect(log.getAll()).toEqual([]);
    const e = log.append("2026-01-02", "y");
    expect(e.id).toBe(1);
  });

  it("size tracks", () => {
    const log = new EventLog();
    expect(log.size).toBe(0);
    log.append("2026-01-01", "a");
    expect(log.size).toBe(1);
  });
});
