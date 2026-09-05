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
  // Check countries count sanity: 16 expected but allow any
  const ecoKeys = Object.keys(o.economies as Record<string, unknown>);
  if (ecoKeys.length === 0) return { ok: false, error: "Сейв повреждён: нет стран / Save corrupted: no countries" };
  // Check units fields sanity
  for (const u of o.units as Array<Record<string, unknown>>) {
    if (typeof u.unitId !== "string") return { ok: false, error: `Сейв повреждён: unit без unitId / Save corrupted: unit without unitId` };
    if (typeof u.countryId !== "string") return { ok: false, error: `Сейв повреждён: unit ${u.unitId} без countryId / Save corrupted: unit without countryId` };
  }
  return { ok: true, save: o as unknown as SaveV1 };
}

export function saveGame(sim: SimEngine): SaveV1 {
  // Use engine's toSave if available, with fallback manual
  const anySim = sim as unknown as { toSave?: () => SaveV1; serialize?: () => SaveV1 };
  if (typeof anySim.toSave === "function") {
    return anySim.toSave();
  }
  // Fallback: build via snapshot + engine internals via any
  const snap = sim.getSnapshot();
  const any = sim as unknown as Record<string, unknown>;
  // Try to read private maps via any
  const economiesMap = (any.economies as Map<string, unknown>) ?? new Map();
  const economies: Record<string, SerializedEconomy> = {};
  // Use snapshot economies as base if private not accessible
  if (snap.economies) {
    for (const [cid, eco] of Object.entries(snap.economies)) {
      // need controlledRegions + eduHistory etc — fetch via getEconomy
      const full = (sim as unknown as { getEconomy:(id:string)=>unknown }).getEconomy(cid) as unknown as Record<string, unknown>;
      if (full) {
        const controlled = full.controlledRegions instanceof Set ? Array.from(full.controlledRegions as Set<string>) : [];
        economies[cid] = {
          countryId: cid,
          treasury: full.treasury as number,
          debt: full.debt as number,
          gdp: full.gdp as number,
          taxRate: full.taxRate as number,
          weights: { ...(full.weights as Record<string, number>) } as SerializedEconomy["weights"],
          activeProjects: (full.activeProjects as SerializedEconomy["activeProjects"]) ?? [],
          completedProjects: (full.completedProjects as SerializedEconomy["completedProjects"]) ?? [],
          eduHistory: (full.eduHistory as number[]) ?? [],
          lastIncome: full.lastIncome as number,
          lastExpense: full.lastExpense as number,
          lastInterest: full.lastInterest as number,
          lastGrowthRate: full.lastGrowthRate as number,
          lastSupport: full.lastSupport as number,
          controlledRegions: controlled,
          lastChangeReason: (full.lastChangeReason as string | null) ?? null,
        };
      } else {
        economies[cid] = {
          countryId: cid,
          treasury: eco.treasury,
          debt: eco.debt,
          gdp: eco.gdp,
          taxRate: eco.taxRate,
          weights: eco.weights as SerializedEconomy["weights"],
          activeProjects: [],
          completedProjects: [],
          eduHistory: [],
          lastIncome: eco.lastIncome,
          lastExpense: eco.lastExpense,
          lastInterest: eco.lastInterest,
          lastGrowthRate: eco.lastGrowthRate,
          lastSupport: eco.lastSupport,
          controlledRegions: [],
          lastChangeReason: null,
        };
      }
    }
  } else {
    // fallback from economiesMap
    for (const [cid, eco] of economiesMap.entries()) {
      const e = eco as Record<string, unknown>;
      economies[cid] = {
        countryId: cid,
        treasury: e.treasury as number,
        debt: e.debt as number,
        gdp: e.gdp as number,
        taxRate: e.taxRate as number,
        weights: { ...(e.weights as Record<string, number>) } as SerializedEconomy["weights"],
        activeProjects: (e.activeProjects as SerializedEconomy["activeProjects"]) ?? [],
        completedProjects: (e.completedProjects as SerializedEconomy["completedProjects"]) ?? [],
        eduHistory: (e.eduHistory as number[]) ?? [],
        lastIncome: e.lastIncome as number,
        lastExpense: e.lastExpense as number,
        lastInterest: e.lastInterest as number,
        lastGrowthRate: e.lastGrowthRate as number,
        lastSupport: e.lastSupport as number,
        controlledRegions: e.controlledRegions instanceof Set ? Array.from(e.controlledRegions as Set<string>) : [],
        lastChangeReason: (e.lastChangeReason as string | null) ?? null,
      };
    }
  }

  const regions = snap.regions ?? [];
  // Need full regionStates with countryId — regions snapshot already has needed fields plus we can add countryId via scenario
  const fullRegions = regions.map((r) => {
    const scenReg = (sim.getScenario()?.regions.find((rr) => rr.regionId === r.regionId) as unknown as Record<string, unknown>);
    return {
      regionId: r.regionId,
      ownerId: r.ownerId,
      controllerId: r.controllerId,
      terrain: r.terrain,
      fortLevel: r.fortLevel,
      isCapitalRegion: r.isCapitalRegion,
      countryId: (scenReg?.countryId as string) ?? r.ownerId,
    };
  });

  const units = snap.units ?? [];
  const warsRaw = snap.wars ?? [];
  const wars = warsRaw.map((w) => ({
    warId: w.warId,
    attackerId: w.attackerId,
    defenderId: w.defenderId,
    startDay: w.startDay,
    startDate: w.startDate,
    status: w.status,
    endDay: w.endDay,
    endDate: w.endDate,
    endReason: w.endReason,
    exhaustionAttacker: (w as unknown as { exhaustionAttacker:number }).exhaustionAttacker ?? 0,
    exhaustionDefender: (w as unknown as { exhaustionDefender:number }).exhaustionDefender ?? 0,
    casualtiesAttacker: 0,
    casualtiesDefender: 0,
  })) as unknown as SaveV1["wars"];

  // Try to get actual wars with casualties from engine's private wars map
  const warsMap = (any.wars as Map<string, unknown>);
  if (warsMap) {
    const actualWars: SaveV1["wars"] = [];
    for (const [, wRaw] of warsMap.entries()) {
      const w = wRaw as Record<string, unknown>;
      actualWars.push({
        warId: w.warId as string,
        attackerId: w.attackerId as string,
        defenderId: w.defenderId as string,
        startDay: w.startDay as number,
        startDate: w.startDate as string,
        status: w.status as "active"|"ended",
        endDay: w.endDay as number|undefined,
        endDate: w.endDate as string|undefined,
        endReason: w.endReason as string|undefined,
        exhaustionAttacker: w.exhaustionAttacker as number,
        exhaustionDefender: w.exhaustionDefender as number,
        casualtiesAttacker: w.casualtiesAttacker as number,
        casualtiesDefender: w.casualtiesDefender as number,
      });
    }
    // override wars
    if (actualWars.length > 0) {
      wars.splice(0, wars.length, ...actualWars);
    }
  }

  const countryEconomy = snap.countryEconomy ?? {};
  const threats = snap.threats ?? {};
  const politicsStates = snap.politics?.states ?? {};
  const relations = snap.politics?.relations ?? {};
  const trust = snap.politics?.trust ?? {};
  const logTail = sim.getEventLogTail(100).map((e) => ({ ...e }));
  const rngState = sim.getRngState();
  const customState = sim.getCustomState() as Record<string, number>;
  const nextIds = {
    nextUnitSeq: (any.nextUnitSeq as number) ?? 1,
    nextProjectId: (any.nextProjectId as number) ?? 1,
    nextWarId: (any.nextWarId as number) ?? 1,
  };
  const playerCountryId = (any.playerCountryId as string | null) ?? null;
  const aiProfiles = (any.aiProfiles as Record<string, string>) ?? {};
  const aiLastRun = (any.aiLastRun as Map<string, number>) ? Object.fromEntries((any.aiLastRun as Map<string, number>).entries()) : {};

  return {
    version: SAVE_VERSION,
    seed: sim.getSeed(),
    date: sim.getDate(),
    daysElapsed: sim.getDaysElapsed(),
    tickCount: sim.getTickCount(),
    rngState,
    customState: { ...customState },
    nextIds,
    economies,
    countryEconomy: { ...countryEconomy },
    regions: fullRegions,
    units: units.map((u) => ({ ...u })),
    wars,
    threats: { ...threats },
    politics: { ...politicsStates } as SaveV1["politics"],
    relations: { ...relations },
    trust: { ...trust },
    logTail,
    playerCountryId,
    aiProfiles,
    aiLastRun,
  };
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
    const EngineAny = SimEngine as unknown as { fromSave?: (s:SaveV1)=>SimEngine };
    if (typeof EngineAny.fromSave === "function") {
      const sim = EngineAny.fromSave(save);
      return { ok: true, sim };
    }
    const sim = createSim({ seed: save.seed, startDate: "2026-01-01" }) as unknown as Record<string, unknown>;
    if (typeof (sim as unknown as { restoreFromSave?: (s:SaveV1)=>void }).restoreFromSave === "function") {
      (sim as unknown as { restoreFromSave: (s:SaveV1)=>void }).restoreFromSave(save);
      return { ok: true, sim: sim as unknown as SimEngine };
    }
    // Manual restore via private fields
    // We attempt to set fields directly
    // Calendar
    const cal = (sim as unknown as { calendar: { current: Date; _daysElapsed:number } }).calendar;
    if (cal) {
      cal.current = new Date(Date.UTC(...save.date.split("-").map((v,i)=> i===1 ? Number(v)-1 : Number(v)) as unknown as [number,number,number]));
      // Use parseGameDate logic: need to handle correctly
      const [y,m,d] = save.date.split("-").map(Number);
      cal.current = new Date(Date.UTC(y, m-1, d));
      cal._daysElapsed = save.daysElapsed;
    }
    // rng
    const rng = (sim as unknown as { rng: { setState:(n:number)=>void } }).rng;
    if (rng) rng.setState(save.rngState);
    // tickCount
    (sim as unknown as Record<string, unknown>).tickCount = save.tickCount;
    // customState
    (sim as unknown as Record<string, unknown>).customState = { ...save.customState };
    // nextIds
    (sim as unknown as Record<string, unknown>).nextUnitSeq = save.nextIds.nextUnitSeq;
    (sim as unknown as Record<string, unknown>).nextProjectId = save.nextIds.nextProjectId;
    (sim as unknown as Record<string, unknown>).nextWarId = save.nextIds.nextWarId;
    // playerCountryId
    (sim as unknown as Record<string, unknown>).playerCountryId = save.playerCountryId ?? null;
    // aiProfiles & lastRun
    (sim as unknown as Record<string, unknown>).aiProfiles = { ... (save.aiProfiles ?? {}) };
    if (save.aiLastRun) {
      (sim as unknown as Record<string, unknown>).aiLastRun = new Map(Object.entries(save.aiLastRun));
    }

    // economies
    const economiesMap = (sim as unknown as { economies: Map<string, unknown> }).economies;
    if (economiesMap) {
      economiesMap.clear();
      for (const [cid, se] of Object.entries(save.economies)) {
        const eco: Record<string, unknown> = {
          countryId: se.countryId,
          treasury: se.treasury,
          debt: se.debt,
          gdp: se.gdp,
          taxRate: se.taxRate,
          weights: { ...se.weights },
          activeProjects: [...se.activeProjects],
          completedProjects: [...se.completedProjects],
          eduHistory: [...se.eduHistory],
          lastIncome: se.lastIncome,
          lastExpense: se.lastExpense,
          lastInterest: se.lastInterest,
          lastGrowthRate: se.lastGrowthRate,
          lastSupport: se.lastSupport,
          controlledRegions: new Set(se.controlledRegions),
          lastChangeReason: se.lastChangeReason,
        };
        economiesMap.set(cid, eco);
      }
    }

    // regionController
    const rcMap = (sim as unknown as { regionController: Map<string, string> }).regionController;
    if (rcMap) {
      rcMap.clear();
      for (const r of save.regions) rcMap.set(r.regionId, r.controllerId);
    }

    // regionStates
    const rsMap = (sim as unknown as { regionStates: Map<string, unknown> }).regionStates;
    if (rsMap) {
      rsMap.clear();
      for (const r of save.regions) {
        rsMap.set(r.regionId, {
          regionId: r.regionId,
          countryId: r.countryId,
          ownerId: r.ownerId,
          controllerId: r.controllerId,
          terrain: r.terrain,
          fortLevel: r.fortLevel,
          isCapitalRegion: r.isCapitalRegion,
        });
      }
    }

    // countryEconomy
    const ceMap = (sim as unknown as { countryEconomy: Map<string, unknown> }).countryEconomy;
    if (ceMap) {
      ceMap.clear();
      for (const [cid, v] of Object.entries(save.countryEconomy)) ceMap.set(cid, { ...v });
    }

    // units
    const unitsMap = (sim as unknown as { units: Map<string, unknown> }).units;
    if (unitsMap) {
      unitsMap.clear();
      for (const u of save.units) unitsMap.set(u.unitId, { ...u });
    }

    // wars
    const warsMap2 = (sim as unknown as { wars: Map<string, unknown> }).wars;
    if (warsMap2) {
      warsMap2.clear();
      for (const w of save.wars) warsMap2.set(w.warId, { ...w });
    }

    // threat
    const threatMap = (sim as unknown as { threat: Map<string, number> }).threat;
    if (threatMap) {
      threatMap.clear();
      for (const [k,v] of Object.entries(save.threats)) threatMap.set(k, v);
    }

    // politics
    const polMap = (sim as unknown as { politics: Map<string, unknown> }).politics;
    if (polMap) {
      polMap.clear();
      for (const [cid, ps] of Object.entries(save.politics)) polMap.set(cid, { ...ps, pendingRegimeChange: ps.pendingRegimeChange ? { ...ps.pendingRegimeChange } : null });
    }
    const relMap = (sim as unknown as { relations: Map<string, number> }).relations;
    if (relMap) {
      relMap.clear();
      for (const [k,v] of Object.entries(save.relations)) relMap.set(k, v);
    }
    const trustMap = (sim as unknown as { trust: Map<string, number> }).trust;
    if (trustMap) {
      trustMap.clear();
      for (const [k,v] of Object.entries(save.trust)) trustMap.set(k, v);
    }

    // log
    const logObj = (sim as unknown as { log: { events: unknown[]; nextId:number; clear:()=>void; append:(d:string,k:string,p:unknown,m?:string)=>void } }).log;
    if (logObj) {
      // clear and re-append tail (we lose full history but keep tail as spec says logTail)
      logObj.clear();
      for (const e of save.logTail) {
        logObj.append(e.date, e.kind, e.payload, e.message);
        // preserve id if needed: override nextId
      }
      // restore nextId to max+1
      if (save.logTail.length > 0) {
        const maxId = Math.max(...save.logTail.map((e)=>e.id));
        logObj.nextId = maxId + 1;
      }
    }

    return { ok: true, sim: sim as unknown as SimEngine };
  } catch (e) {
    return { ok: false, error: `Сейв повреждён: ошибка восстановления / Save corrupted: restore error — ${(e as Error).message}` };
  }
}

// LocalStorage helpers (guard for non-browser env)
export function saveToSlot(slot: number | string, sim: SimEngine): { ok: true } | { ok: false; error: string } {
  const key = typeof slot === "number" ? `wb-save-slot-${slot}` : slot;
  if (typeof localStorage === "undefined") return { ok: false, error: "localStorage недоступен / not available" };
  try {
    const save = saveGame(sim);
    const json = JSON.stringify(save);
    localStorage.setItem(key, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Ошибка сохранения слота ${key}: ${(e as Error).message}` };
  }
}

export function loadFromSlot(slot: number | string): { ok: true; sim: SimEngine } | { ok: false; error: string } {
  const key = typeof slot === "number" ? `wb-save-slot-${slot}` : slot;
  if (typeof localStorage === "undefined") return { ok: false, error: "localStorage недоступен / not available" };
  const json = localStorage.getItem(key);
  if (!json) return { ok: false, error: `Слот ${key} пуст / Slot ${key} empty` };
  return loadGame(json);
}

export function exportSaveToFile(sim: SimEngine, filename = `worldbalance-save-${sim.getDate()}.json`): void {
  if (typeof document === "undefined") return;
  const save = saveGame(sim);
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSaveFromFile(file: File): Promise<{ ok: true; sim: SimEngine } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      resolve(loadGame(text));
    };
    reader.onerror = () => resolve({ ok: false, error: "Ошибка чтения файла / File read error" });
    reader.readAsText(file);
  });
}
