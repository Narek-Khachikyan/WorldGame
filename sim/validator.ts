import type { Command, ValidationResult } from "./types.js";

/**
 * Command validator skeleton.
 * In T1 validates a small set of known commands; unknown types are rejected with reason.
 * Future tickets extend whitelist without breaking existing tests.
 */

const KNOWN_TYPES = new Set([
  "noop",
  "testPing",
  "incrementCounter",
  "setTax",
  "setWeights",
  "startProject",
  "setRegionController",
  // alias for loss test readability
  "loseRegion",
  "cancelProject",
]);

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

  if (c.type === "setTax") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "setTax requires payload {countryId, taxRate}" };
    if (typeof p.countryId !== "string" || (p.countryId as string).trim() === "")
      return { ok: false, reason: "setTax payload.countryId must be non-empty string" };
    if (typeof p.taxRate !== "number" || !Number.isFinite(p.taxRate))
      return { ok: false, reason: "setTax payload.taxRate must be finite number" };
    // range will be checked in engine with rules for precise message
    return { ok: true };
  }

  if (c.type === "setWeights") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "setWeights requires payload {countryId, weights}" };
    if (typeof p.countryId !== "string" || (p.countryId as string).trim() === "")
      return { ok: false, reason: "setWeights payload.countryId must be non-empty string" };
    if (!p.weights || typeof p.weights !== "object")
      return { ok: false, reason: "setWeights payload.weights must be object {defense,infra,social,edu}" };
    const w = p.weights as Record<string, unknown>;
    for (const cat of ["defense", "infra", "social", "edu"]) {
      if (typeof w[cat] !== "number" || !Number.isFinite(w[cat] as number))
        return { ok: false, reason: `setWeights weights.${cat} must be finite number 0..1` };
      const v = w[cat] as number;
      if (v < 0 || v > 1) return { ok: false, reason: `setWeights weights.${cat} must be 0..1, got ${v}` };
    }
    return { ok: true };
  }

  if (c.type === "startProject") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "startProject requires payload {countryId, regionId, projectType}" };
    if (typeof p.countryId !== "string" || (p.countryId as string).trim() === "")
      return { ok: false, reason: "startProject payload.countryId must be non-empty string" };
    if (typeof p.regionId !== "string" || (p.regionId as string).trim() === "")
      return { ok: false, reason: "startProject payload.regionId must be non-empty string" };
    if (typeof p.projectType !== "string" || (p.projectType as string).trim() === "")
      return { ok: false, reason: "startProject payload.projectType must be non-empty string" };
    const allowed = ["industrialComplex", "powerUnit", "regionInfra"];
    if (!allowed.includes(p.projectType as string))
      return { ok: false, reason: `startProject projectType must be one of ${allowed.join(",")}, got ${p.projectType}` };
    return { ok: true };
  }

  if (c.type === "setRegionController" || c.type === "loseRegion") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: `${c.type} requires payload {regionId, newControllerId}` };
    // loseRegion is alias: {countryId?, regionId}
    if (c.type === "loseRegion") {
      if (typeof p.regionId !== "string" || (p.regionId as string).trim() === "")
        return { ok: false, reason: "loseRegion payload.regionId must be non-empty string" };
      return { ok: true };
    }
    if (typeof p.regionId !== "string" || (p.regionId as string).trim() === "")
      return { ok: false, reason: "setRegionController payload.regionId must be non-empty string" };
    if (typeof p.newControllerId !== "string" || (p.newControllerId as string).trim() === "")
      return { ok: false, reason: "setRegionController payload.newControllerId must be non-empty string" };
    return { ok: true };
  }

  if (c.type === "cancelProject") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "cancelProject requires payload {projectId}" };
    if (typeof p.projectId !== "string" || (p.projectId as string).trim() === "")
      return { ok: false, reason: "cancelProject payload.projectId must be non-empty string" };
    return { ok: true };
  }

  // noop
  return { ok: true };
}
