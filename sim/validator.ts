import type { Command, ValidationResult } from "./types.js";

/**
 * Command validator skeleton.
 * In T1 validates a small set of known commands; unknown types are rejected with reason.
 * Future tickets extend whitelist without breaking existing tests.
 */

// Shared COMMAND_SPECS map — single source for known types used by both validator and engine dispatch (Repeated Switches fix).
// To add a new command, update this map and ensure engine dispatch + rules + UI checklist in sim/engine.ts header.
export const COMMAND_SPECS: Record<string, { payload: string }> = {
  noop: { payload: "none" },
  testPing: { payload: "object?" },
  incrementCounter: { payload: "{key, delta}" },
  setTax: { payload: "{countryId, taxRate}" },
  setWeights: { payload: "{countryId, weights}" },
  startProject: { payload: "{countryId, regionId, projectType}" },
  setRegionController: { payload: "{regionId, newControllerId}" },
  loseRegion: { payload: "{regionId, newControllerId?}" },
  cancelProject: { payload: "{projectId}" },
  recruitUnit: { payload: "{countryId, regionId, personnel?, equipment?}" },
  moveUnit: { payload: "{unitId, toRegionId}" },
  setStance: { payload: "{unitId, stance}" },
  declareWar: { payload: "{attacker, defender}" },
  proposePeace: { payload: "{warId, proposer, type}" },
  changeRegime: { payload: "{countryId, newRegime}" },
  changeLeader: { payload: "{countryId, newLeaderId}" },
};
const KNOWN_TYPES = new Set(Object.keys(COMMAND_SPECS));

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

  if (c.type === "declareWar") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "declareWar requires payload {attacker, defender}" };
    if (typeof p.attacker !== "string" || (p.attacker as string).trim() === "") return { ok: false, reason: "declareWar payload.attacker must be non-empty string" };
    if (typeof p.defender !== "string" || (p.defender as string).trim() === "") return { ok: false, reason: "declareWar payload.defender must be non-empty string" };
    // allow optional reason field string
    if (p.reason !== undefined && typeof p.reason !== "string") return { ok: false, reason: "declareWar payload.reason must be string if present" };
    return { ok: true };
  }

  if (c.type === "proposePeace") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "proposePeace requires payload {warId, proposer, type}" };
    if (typeof p.warId !== "string" || (p.warId as string).trim() === "") return { ok: false, reason: "proposePeace payload.warId must be non-empty string" };
    if (typeof p.proposer !== "string" || (p.proposer as string).trim() === "") return { ok: false, reason: "proposePeace payload.proposer must be non-empty string" };
    if (typeof p.type !== "string" || (p.type as string).trim() === "") return { ok: false, reason: "proposePeace payload.type must be non-empty string" };
    const allowed = ["white", "annexOccupied", "indemnity"];
    if (!allowed.includes(p.type as string)) return { ok: false, reason: `proposePeace type must be one of ${allowed.join("|")}, got ${p.type}` };
    return { ok: true };
  }

  if (c.type === "changeRegime") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "changeRegime requires payload {countryId, newRegime}" };
    if (typeof p.countryId !== "string" || (p.countryId as string).trim() === "") return { ok: false, reason: "changeRegime payload.countryId must be non-empty string" };
    if (typeof p.newRegime !== "string" || (p.newRegime as string).trim() === "") return { ok: false, reason: "changeRegime payload.newRegime must be non-empty string" };
    return { ok: true };
  }

  if (c.type === "changeLeader") {
    const p = c.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") return { ok: false, reason: "changeLeader requires payload {countryId, newLeaderId}" };
    if (typeof p.countryId !== "string" || (p.countryId as string).trim() === "") return { ok: false, reason: "changeLeader payload.countryId must be non-empty string" };
    if (typeof p.newLeaderId !== "string" || (p.newLeaderId as string).trim() === "") return { ok: false, reason: "changeLeader payload.newLeaderId must be non-empty string" };
    return { ok: true };
  }

  // noop
  return { ok: true };
}
