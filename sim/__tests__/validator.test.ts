import { describe, it, expect } from "vitest";
import { validateCommand } from "../validator.js";

describe("command validator skeleton", () => {
  it("accepts noop", () => {
    expect(validateCommand({ type: "noop" })).toEqual({ ok: true });
  });

  it("accepts testPing with and without payload", () => {
    expect(validateCommand({ type: "testPing" }).ok).toBe(true);
    expect(validateCommand({ type: "testPing", payload: { message: "hi" } }).ok).toBe(true);
  });

  it("accepts incrementCounter with valid payload", () => {
    expect(validateCommand({ type: "incrementCounter", payload: { key: "gold", delta: 5 } }).ok).toBe(true);
    expect(validateCommand({ type: "incrementCounter", payload: { key: "x", delta: -1 } }).ok).toBe(true);
  });

  it("rejects unknown type with reason", () => {
    const r = validateCommand({ type: "declareWar" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown command type/);
  });

  it("rejects missing type", () => {
    expect(validateCommand({}).ok).toBe(false);
    expect(validateCommand(null).ok).toBe(false);
    expect(validateCommand({ type: "" }).ok).toBe(false);
    expect(validateCommand({ type: 123 } as unknown as { type: string }).ok).toBe(false);
  });

  it("rejects incrementCounter with bad payload", () => {
    expect(validateCommand({ type: "incrementCounter" }).ok).toBe(false);
    expect(validateCommand({ type: "incrementCounter", payload: { key: "", delta: 1 } }).ok).toBe(false);
    expect(validateCommand({ type: "incrementCounter", payload: { key: "a", delta: NaN } }).ok).toBe(false);
    expect(validateCommand({ type: "incrementCounter", payload: { key: "a" } }).ok).toBe(false);
  });

  it("rejects testPing with non-object payload", () => {
    expect(validateCommand({ type: "testPing", payload: "hi" as unknown as object }).ok).toBe(false);
  });
});
