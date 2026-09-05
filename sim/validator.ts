import type { Command, ValidationResult } from "./types.js";

/**
 * Command validator skeleton.
 * In T1 validates a small set of known commands; unknown types are rejected with reason.
 * Future tickets extend whitelist without breaking existing tests.
 */

const KNOWN_TYPES = new Set(["noop", "testPing", "incrementCounter"]);

export function validateCommand(cmd: unknown): ValidationResult {
  if (cmd === null || cmd === undefined || typeof cmd !== "object") {
    return { ok: false, reason: "command must be an object" };
  }
  const c = cmd as Record<string, unknown>;
  if (typeof c.type !== "string") {
    return { ok: false, reason: "missing or invalid command type" };
  }
  if (c.type.trim() === "") {
    return { ok: false, reason: "command type must be non-empty string" };
  }
  if (!KNOWN_TYPES.has(c.type)) {
    return { ok: false, reason: `unknown command type: ${c.type}` };
  }

  // per-type payload checks
  if (c.type === "testPing") {
    if (c.payload !== undefined && c.payload !== null && typeof c.payload !== "object") {
      return { ok: false, reason: "testPing payload must be object if present" };
    }
    return { ok: true };
  }

  if (c.type === "incrementCounter") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") {
      return { ok: false, reason: "incrementCounter requires payload {key, delta}" };
    }
    if (typeof p.key !== "string" || p.key.trim() === "") {
      return { ok: false, reason: "incrementCounter payload.key must be non-empty string" };
    }
    if (typeof p.delta !== "number" || !Number.isFinite(p.delta)) {
      return { ok: false, reason: "incrementCounter payload.delta must be finite number" };
    }
    return { ok: true };
  }

  // noop
  return { ok: true };
}
