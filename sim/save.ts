/**
 * Persistence A — сейв/лоад JSON v1.
 * SaveV1: version/seed/date/countries/regions/units/elections/log tail + full sim state for determinism.
 * Validation on load, broken/incompatible save = {ok:false, error} без краша (no throw in UI).
 * Local slots + file export/import handled here (localStorage + JSON).
 */

import { SimEngine, createSim } from "./engine.js";

export const SAVE_VERSION = 1 as const;
export const SAVE_SLOTS = ["wb-save-slot-1", "wb-save-slot-2", "wb-save-slot-3"] as const;

export interface SerializedEconomy {
  countryId: string;
  treasury: number;
  debt: number;
  gdp: number;
  taxRate: number;
  weights: { defense: number; infra: number; social: number; edu: number };
  activeProjects: Array<{ id: string; countryId: string; regionId: string; type: string; price: number; durationDays: number; startDay: number; startDate: string; endDay: number; endDate: string; status: "active"|"completed" }>;
  completedProjects: Array<{ id: string; countryId: string; regionId: string; type: string; price: number; durationDays: number; startDay: number; startDate: string; endDay: number; endDate: string; status: "active"|"completed" }>;
  eduHistory: number[];
  lastIncome: number;
  lastExpense: number;
  lastInterest: number;
  lastGrowthRate: number;
  lastSupport: number;
  controlledRegions: string[];
  lastChangeReason: string | null;
}

export interface SaveV1 {
  version: 1;
  seed: number;
  date: string; // YYYY-MM-DD
  daysElapsed: number;
  tickCount: number;
  rngState: number;
  customState: Record<string, number>;
  nextIds: { nextUnitSeq: number; nextProjectId: number; nextWarId: number };
  economies: Record<string, SerializedEconomy>;
  countryEconomy: Record<string, { treasury: number; population: number; equipmentStock: number }>;
  regions: Array<{ regionId:string; ownerId:string; controllerId:string; terrain:string; fortLevel:number; isCapitalRegion:boolean; countryId:string }>;
  units: Array<{ unitId:string; countryId:string; regionId:string; personnel:number; equipment:number; readiness:number; stance:string; supplyBase?:string; daysUntilReady:number; hiringTimeDays:number }>;
  wars: Array<{ warId:string; attackerId:string; defenderId:string; startDay:number; startDate:string; status:"active"|"ended"; endDay?:number; endDate?:string; endReason?:string; exhaustionAttacker:number; exhaustionDefender:number; casualtiesAttacker:number; casualtiesDefender:number }>;
  threats: Record<string, number>;
  politics: Record<string, { countryId:string; regime:string; leaderId:string; leaderTitle:string; partyId:string; stability:number; support:number; warFatigueLite:number; nextElectionDate:string; regimeCooldownUntil:string|null; pendingRegimeChange:{newRegime:string; effectiveDay:number; effectiveDate:string}|null; crisisLevel:number; lastElectionDate:string|null }>;
  relations: Record<string, number>;
  trust: Record<string, number>;
  logTail: Array<{ id:number; date:string; kind:string; payload?:unknown; message?:string }>;
  playerCountryId: string | null;
  aiProfiles?: Record<string, string>;
  aiLastRun?: Record<string, number>;
  // legacy snapshot for compatibility checks
  snapshot?: unknown;
}

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function validateSaveObject(obj: unknown): { ok: true; save: SaveV1 } | { ok: false; error: string } {
  if (!obj || typeof obj !== "object") return { ok: false, error: "Сейв повреждён: не объект / Save corrupted: not an object" };
  const o = obj as Record<string, unknown>;
  if (o.version !== SAVE_VERSION) {
    const got = o.version;
    return { ok: false, error: `Сейв несовместим: ожидается версия ${SAVE_VERSION}, получена ${String(got)} / Save incompatible: expected version ${SAVE_VERSION}, got ${String(got)}` };
  }
  if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) return { ok: false, error: "Сейв повреждён: seed не число / Save corrupted: seed not a number" };
  if (typeof o.date !== "string" || !isValidDateString(o.date)) return { ok: false, error: "Сейв повреждён: неверная дата / Save corrupted: invalid date" };
  if (typeof o.daysElapsed !== "number" || o.daysElapsed < 0) return { ok: false, error: "Сейв повреждён: daysElapsed / Save corrupted: daysElapsed" };
  if (typeof o.tickCount !== "number" || o.tickCount < 0) return { ok: false, error: "Сейв повреждён: tickCount / Save corrupted: tickCount" };
  if (typeof o.rngState !== "number") return { ok: false, error: "Сейв повреждён: rngState / Save corrupted: rngState" };
  if (!o.economies || typeof o.economies !== "object") return { ok: false, error: "Сейв повреждён: economies / Save corrupted: economies" };
  if (!Array.isArray(o.regions)) return { ok: false, error: "Сейв повреждён: regions должны быть массивом / Save corrupted: regions must be array" };
  if (!Array.isArray(o.units)) return { ok: false, error: "Сейв повреждён: units должны быть массивом / Save corrupted: units must be array" };
  if (!Array.isArray(o.wars)) return { ok: false, error: "Сейв повреждён: wars должны быть массивом / Save corrupted: wars must be array" };
  if (!o.politics || typeof o.politics !== "object") return { ok: false, error: "Сейв повреждён: politics / Save corrupted: politics" };
  if (!Array.isArray(o.logTail)) return { ok: false, error: "Сейв повреждён: logTail должны быть массивом / Save corrupted: logTail must be array" };
  // Spec B: extended validation — countries==16, regions 60-120, units array, politics.elections/nextElectionDate, logTail
  const ecoKeys = Object.keys(o.economies as Record<string, unknown>);
  if (ecoKeys.length !== 16) return { ok: false, error: `Сейв повреждён: ожидается 16 стран, получено ${ecoKeys.length} / Save corrupted: expected 16 countries, got ${ecoKeys.length}` };
  const regions = o.regions as unknown[];
  if (regions.length < 60 || regions.length > 120) return { ok: false, error: `Сейв повреждён: regions 60–120, получено ${regions.length} / Save corrupted: regions 60–120, got ${regions.length}` };
  // units already array, check each has countryId
  for (const u of o.units as Array<Record<string, unknown>>) {
    if (typeof u.unitId !== "string") return { ok: false, error: `Сейв повреждён: unit без unitId / Save corrupted: unit without unitId` };
    if (typeof u.countryId !== "string") return { ok: false, error: `Сейв повреждён: unit ${u.unitId} без countryId / Save corrupted: unit without countryId` };
  }
  // politics: each entry must have nextElectionDate valid + lastElectionDate present (may be null)
  const pol = o.politics as Record<string, unknown>;
  for (const [cid, v] of Object.entries(pol)) {
    const ps = v as Record<string, unknown>;
    if (typeof ps.nextElectionDate !== "string" || !isValidDateString(ps.nextElectionDate)) {
      return { ok: false, error: `Сейв повреждён: politics[${cid}].nextElectionDate отсутствует/неверна / Save corrupted: politics[${cid}].nextElectionDate missing/invalid` };
    }
    if (ps.regimeCooldownUntil !== null && ps.regimeCooldownUntil !== undefined && typeof ps.regimeCooldownUntil !== "string") {
      return { ok: false, error: `Сейв повреждён: politics[${cid}].regimeCooldownUntil неверна / Save corrupted: politics[${cid}].regimeCooldownUntil invalid` };
    }
  }
  // logTail already array, ensure each has date/kind
  for (const e of o.logTail as Array<Record<string, unknown>>) {
    if (typeof e.date !== "string" || typeof e.kind !== "string") return { ok: false, error: `Сейв повреждён: logTail запись без date/kind / Save corrupted: logTail entry missing date/kind` };
  }
  return { ok: true, save: o as unknown as SaveV1 };
}

export function saveGame(sim: SimEngine): SaveV1 {
  // Pure seam (fix F): use only public engine API, no anyMap fallback
  return sim.toSave();
}

export function serializeSave(save: SaveV1): string {
  return JSON.stringify(save);
}

export function deserializeSave(json: string | object): { ok: true; save: SaveV1 } | { ok: false; error: string } {
  let obj: unknown;
  if (typeof json === "string") {
    try {
      obj = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: `Сейв повреждён: невалидный JSON / Save corrupted: invalid JSON — ${ (e as Error).message }` };
    }
  } else {
    obj = json;
  }
  return validateSaveObject(obj);
}

export function loadGame(json: string | object): { ok: true; sim: SimEngine } | { ok: false; error: string } {
  const parsed = deserializeSave(json);
  if (!parsed.ok) return parsed;
  const save = parsed.save;
  try {
    // Pure seam (fix F + #2): use only public engine API, no reflective fallback
    const sim = SimEngine.fromSave(save);
    return { ok: true, sim };
  } catch (e) {
    return { ok: false, error: `Сейв повреждён: ошибка восстановления / Save corrupted: restore error — ${(e as Error).message}` };
  }
}

// LocalStorage helpers — pure seam (fix F): storage injected, caller (ui/panels/SavePanel.tsx) owns localStorage/Blob/FileReader.
// For tests/backwards compat, fallback to global if injection not provided; pure logic is saveGame/loadGame only.
export function saveToSlot(slot: number | string, sim: SimEngine, storage?: Storage): { ok: true } | { ok: false; error: string } {
  const key = typeof slot === "number" ? `wb-save-slot-${slot}` : slot;
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!store) return { ok: false, error: "localStorage недоступен / not available" };
  try {
    const save = saveGame(sim);
    const json = JSON.stringify(save);
    store.setItem(key, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Ошибка сохранения слота ${key}: ${(e as Error).message}` };
  }
}

export function loadFromSlot(slot: number | string, storage?: Storage): { ok: true; sim: SimEngine } | { ok: false; error: string } {
  const key = typeof slot === "number" ? `wb-save-slot-${slot}` : slot;
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!store) return { ok: false, error: "localStorage недоступен / not available" };
  const json = store.getItem(key);
  if (!json) return { ok: false, error: `Слот ${key} пуст / Slot ${key} empty` };
  return loadGame(json);
}

export function exportSaveToFile(sim: SimEngine, filename = `worldbalance-save-${sim.getDate()}.json`, deps?: { document?: Document; Blob?: typeof Blob; URL?: typeof URL }): void {
  const doc = deps?.document ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) return;
  const BlobCtor = deps?.Blob ?? Blob;
  const URLCtor = deps?.URL ?? URL;
  const save = saveGame(sim);
  const blob = new BlobCtor([JSON.stringify(save, null, 2)], { type: "application/json" });
  const url = URLCtor.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URLCtor.revokeObjectURL(url), 1000);
}

export function importSaveFromFile(file: File, deps?: { FileReader?: typeof FileReader }): Promise<{ ok: true; sim: SimEngine } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const Reader = deps?.FileReader ?? FileReader;
    const reader = new Reader();
    reader.onload = () => {
      const text = reader.result as string;
      resolve(loadGame(text));
    };
    reader.onerror = () => resolve({ ok: false, error: "Ошибка чтения файла / File read error" });
    reader.readAsText(file as unknown as Blob);
  });
}
