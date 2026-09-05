import type { Command, ValidationResult } from "./types.js";

/**
 * Command validator skeleton.
 * In T1 validates a small set of known commands; unknown types are rejected with reason.
 * Future tickets extend whitelist without breaking existing tests.
 */

const KNOWN_TYPES = new Set(["noop", "testPing", "incrementCounter", "recruitUnit", "moveUnit", "setStance"]);

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

  if (c.type === "recruitUnit") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") {
      return { ok: false, reason: "recruitUnit requires payload {countryId, regionId}" };
    }
    if (typeof p.countryId !== "string" || (p.countryId as string).trim() === "") {
      return { ok: false, reason: "recruitUnit payload.countryId must be non-empty string" };
    }
    if (typeof p.regionId !== "string" || (p.regionId as string).trim() === "") {
      return { ok: false, reason: "recruitUnit payload.regionId must be non-empty string" };
    }
    if (p.personnel !== undefined && (typeof p.personnel !== "number" || !Number.isFinite(p.personnel))) {
      return { ok: false, reason: "recruitUnit payload.personnel must be finite number if present" };
    }
    if (p.equipment !== undefined && (typeof p.equipment !== "number" || !Number.isFinite(p.equipment))) {
      return { ok: false, reason: "recruitUnit payload.equipment must be finite number if present" };
    }
    if (p.readiness !== undefined && (typeof p.readiness !== "number" || !Number.isFinite(p.readiness))) {
      return { ok: false, reason: "recruitUnit payload.readiness must be finite number if present" };
    }
    if (p.unitId !== undefined && (typeof p.unitId !== "string" || (p.unitId as string).trim() === "")) {
      return { ok: false, reason: "recruitUnit payload.unitId must be non-empty string if present" };
    }
    return { ok: true };
  }

  if (c.type === "moveUnit") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") {
      return { ok: false, reason: "moveUnit requires payload {unitId, toRegionId}" };
    }
    if (typeof p.unitId !== "string" || (p.unitId as string).trim() === "") {
      return { ok: false, reason: "moveUnit payload.unitId must be non-empty string" };
    }
    if (typeof p.toRegionId !== "string" || (p.toRegionId as string).trim() === "") {
      return { ok: false, reason: "moveUnit payload.toRegionId must be non-empty string" };
    }
    return { ok: true };
  }

  if (c.type === "setStance") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") {
      return { ok: false, reason: "setStance requires payload {unitId, stance}" };
    }
    if (typeof p.unitId !== "string" || (p.unitId as string).trim() === "") {
      return { ok: false, reason: "setStance payload.unitId must be non-empty string" };
    }
    if (typeof p.stance !== "string" || (p.stance as string).trim() === "") {
      return { ok: false, reason: "setStance payload.stance must be non-empty string" };
    }
    const valid = new Set(["offensive", "defensive", "entrenched"]);
    if (!valid.has(p.stance as string)) {
      return { ok: false, reason: `setStance stance must be one of offensive|defensive|entrenched, got ${p.stance}` };
    }
    return { ok: true };
  }

  // noop
  return { ok: true };
}
