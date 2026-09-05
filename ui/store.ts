import { create } from "zustand";
import { createSim, TimeAccumulator, DEFAULT_SPEED, type Speed } from "../sim/index.js";
import type { SimEngine } from "../sim/engine.js";
import { loadScenario, type Scenario } from "../sim/scenario.js";
import { runAIStep, getProfileForCountry } from "../sim/ai.js";
import { AI_INTERVAL_DAYS } from "../sim/ai.js";
import { saveGame, loadGame } from "../sim/save.js";

export type MapMode = "political" | "military";

interface GameStore {
  sim: SimEngine;
  scenario: Scenario;
  speed: Speed;
  isPaused: boolean;
  accumulator: TimeAccumulator;
  lastDate: string;
  // map / selection (T3)
  mapMode: MapMode;
  selectedCountryId: string | null;
  selectedRegionId: string | null;
  playerCountryId: string | null;
  hasStarted: boolean;
  aiProfiles: Record<string, string>; // overrides
  // T4 compat alias — keeps EconomyPanel contract while preserving T3 nullable model
  setSelectedCountry: (id: string) => void;
  // actions
  setSpeed: (s: Speed) => void;
  togglePause: () => void;
  tickReal: (deltaSeconds: number) => void;
  dispatch: (cmd: import("../sim/types.js").Command) => import("../sim/types.js").ValidationResult;
  setMapMode: (m: MapMode) => void;
  selectCountry: (id: string | null) => void;
  selectRegion: (id: string | null) => void;
  setPlayerCountry: (id: string | null) => void;
  startGame: (countryId: string) => void;
  resetSelection: () => void;
  setAiProfile: (countryId: string, profile: string) => void;
  loadSim: (newSim: SimEngine) => void;
  runAIForDay: (daysElapsed: number, reason?: string) => void;
}

let _prevSpeed: Speed = DEFAULT_SPEED;

// scenario is static offline data — load once synchronously (throws if invalid, which is fail-fast)
let _scenario: Scenario | null = null;
function getScenario(): Scenario {
  if (!_scenario) _scenario = loadScenario();
  return _scenario;
}

function shouldRunAIOnTick(sim: SimEngine, playerCountryId: string | null, daysElapsed: number, reason?: string): boolean {
  if (reason && reason !== "interval14") return true;
  return daysElapsed % AI_INTERVAL_DAYS === 0;
}

export const useGameStore = create<GameStore>((set, get) => {
  const sim = createSim({ seed: 42 });
  const acc = new TimeAccumulator(DEFAULT_SPEED);
  const scenario = getScenario();
  return {
    sim,
    scenario,
    speed: DEFAULT_SPEED,
    isPaused: false,
    accumulator: acc,
    lastDate: sim.getDate(),
    mapMode: "political",
    selectedCountryId: null,
    selectedRegionId: null,
    playerCountryId: null,
    hasStarted: false,
    aiProfiles: {},

    setSpeed: (s) => {
      const st = get();
      if (s === "paused") {
        _prevSpeed = st.speed !== "paused" ? st.speed : _prevSpeed;
        st.accumulator.setSpeed("paused");
        set({ speed: "paused", isPaused: true });
      } else {
        st.accumulator.setSpeed(s);
        _prevSpeed = s;
        set({ speed: s, isPaused: false });
      }
    },
    togglePause: () => {
      const st = get();
      if (st.isPaused) {
        const to = _prevSpeed;
        st.accumulator.setSpeed(to);
        set({ speed: to, isPaused: false });
      } else {
        _prevSpeed = st.speed;
        st.accumulator.setSpeed("paused");
        set({ speed: "paused", isPaused: true });
      }
    },
    tickReal: (deltaSeconds) => {
      const st = get();
      const days = st.accumulator.advance(deltaSeconds);
      if (days > 0) {
        const beforeTailLen = st.sim.getEventLog().length;
        st.sim.tick(days);
        const afterDays = st.sim.getDaysElapsed();
        // AI every 14 days per country AI-controlled, i.e. all except playerCountryId; also on events war/peace/bankruptcy/elections
        const tail = st.sim.getEventLog().slice(beforeTailLen);
        const hasEventTrigger = tail.some((e) => ["warDeclared","peaceAccepted","peaceRejected","peaceProposed","treasuryWarning","crisisWarning","electionResult","bankruptcy","upkeepDeducted"].includes(e.kind)) && (tail.some((e)=> e.kind==="warDeclared"||e.kind==="peaceAccepted"||e.kind==="electionResult"||e.kind==="treasuryWarning"||e.kind==="crisisWarning"));
        // interval check
        const shouldInterval = afterDays % AI_INTERVAL_DAYS === 0 || (days >= AI_INTERVAL_DAYS);
        // If we ticked multiple days, we may have crossed an interval boundary without landing exactly — ensure we run at least once per 14 days crossed
        const crossedInterval = Math.floor((afterDays)/AI_INTERVAL_DAYS) > Math.floor((afterDays - days)/AI_INTERVAL_DAYS);
        const needAI = crossedInterval || shouldInterval || hasEventTrigger;
        if (needAI) {
          const reason = hasEventTrigger ? "event" : "interval14";
          const player = st.playerCountryId;
          for (const cid of st.sim.getCountryIds()) {
            if (cid === player) continue;
            const profileOverride = st.aiProfiles[cid] as import("../sim/ai.js").AiProfileId | undefined;
            try {
              runAIStep(st.sim, cid, { reason, profileOverride });
              st.sim.setAiLastRun(cid, afterDays);
            } catch {/* ignore AI errors */}
          }
        }
        set({ lastDate: st.sim.getDate() });
      }
    },
    dispatch: (cmd) => {
      const st = get();
      const res = st.sim.dispatch(cmd);
      // on war/peace commands, immediately trigger AI for opponents with event reason
      if (cmd.type === "declareWar" || cmd.type === "proposePeace") {
        const afterDays = st.sim.getDaysElapsed();
        for (const cid of st.sim.getCountryIds()) {
          if (cid === st.playerCountryId) continue;
          // simple event-driven AI: run one step for affected countries
          const involved = cmd.type === "declareWar" ? ((cmd.payload as { attacker?:string; defender?:string })?.attacker===cid || (cmd.payload as { defender?:string })?.defender===cid) : true;
          if (involved || cmd.type==="proposePeace") {
            try { runAIStep(st.sim, cid, { reason: "event" }); st.sim.setAiLastRun(cid, afterDays); } catch {}
          }
        }
      }
      set({ lastDate: st.sim.getDate() });
      return res;
    },
    runAIForDay: (daysElapsed, reason) => {
      const st = get();
      const r = reason ?? (shouldRunAIOnTick(st.sim, st.playerCountryId, daysElapsed) ? "interval14" : undefined);
      if (!r) return;
      for (const cid of st.sim.getCountryIds()) {
        if (cid === st.playerCountryId) continue;
        const profileOverride = st.aiProfiles[cid] as import("../sim/ai.js").AiProfileId | undefined;
        try { runAIStep(st.sim, cid, { reason: r, profileOverride }); st.sim.setAiLastRun(cid, daysElapsed); } catch {}
      }
      set({ lastDate: st.sim.getDate() });
    },
    setMapMode: (m) => set({ mapMode: m }),
    selectCountry: (id) => {
      // when country changes, clear region if it doesn't belong to that country
      const st = get();
      if (id === null) {
        set({ selectedCountryId: null, selectedRegionId: null });
        return;
      }
      // validate id exists
      const exists = st.scenario.countries.some((c) => c.countryId === id);
      if (!exists) return;
      // if region selected but not in this country, clear it
      let nextRegion = st.selectedRegionId;
      if (nextRegion) {
        const reg = st.scenario.regions.find((r) => r.regionId === nextRegion);
        if (!reg || reg.countryId !== id) nextRegion = null;
      }
      set({ selectedCountryId: id, selectedRegionId: nextRegion });
    },
    selectRegion: (id) => {
      const st = get();
      if (id === null) {
        set({ selectedRegionId: null });
        return;
      }
      const reg = st.scenario.regions.find((r) => r.regionId === id);
      if (!reg) return;
      set({ selectedRegionId: id, selectedCountryId: reg.countryId });
    },
    setPlayerCountry: (id) => {
      if (id === null) {
        set({ playerCountryId: null });
        const st2 = get();
        st2.sim.setPlayerCountryId(null);
        return;
      }
      const st = get();
      if (!st.scenario.countries.some((c) => c.countryId === id)) return;
      st.sim.setPlayerCountryId(id);
      set({ playerCountryId: id });
    },
    startGame: (countryId) => {
      const st = get();
      if (!st.scenario.countries.some((c) => c.countryId === countryId)) return;
      st.sim.setPlayerCountryId(countryId);
      set({
        playerCountryId: countryId,
        selectedCountryId: countryId,
        selectedRegionId: null,
        hasStarted: true,
      });
    },
    resetSelection: () => set({ selectedCountryId: null, selectedRegionId: null }),
    setAiProfile: (countryId, profile) => {
      const st = get();
      if (!["cautious","ambitious"].includes(profile)) return;
      st.sim.setAiProfile(countryId, profile);
      set({ aiProfiles: { ...st.aiProfiles, [countryId]: profile } });
    },
    loadSim: (newSim) => {
      const st = get();
      // preserve player linkage? newSim already has playerCountryId from save, or we keep current
      // ensure aiProfiles map sync
      const profiles = newSim.getAllAiProfiles();
      set({ sim: newSim, lastDate: newSim.getDate(), playerCountryId: newSim.getPlayerCountryId(), aiProfiles: profiles, hasStarted: !!newSim.getPlayerCountryId() });
    },
    // T4 compat: alias to selectCountry for existing EconomyPanel callers
    setSelectedCountry: (id) => {
      const st = get();
      // delegate to selectCountry validation
      if (!st.scenario.countries.some((c) => c.countryId === id)) return;
      // reuse logic via direct set to keep T4 simple path
      let nextRegion = st.selectedRegionId;
      if (nextRegion) {
        const reg = st.scenario.regions.find((r) => r.regionId === nextRegion);
        if (!reg || reg.countryId !== id) nextRegion = null;
      }
      set({ selectedCountryId: id, selectedRegionId: nextRegion });
    },
  };
});

if (typeof window !== "undefined") {
  (window as unknown as { __GAME_STORE__?: typeof useGameStore }).__GAME_STORE__ = useGameStore;
  (window as unknown as { __SAVE_FUNCS__?: { saveGame: typeof saveGame; loadGame: typeof loadGame } }).__SAVE_FUNCS__ = { saveGame, loadGame };
}

/** Selectors for topbar stub data (T4/T5 contracts) */
export function useTopbarStubs() {
  const sim = useGameStore((s) => s.sim);
  // For T3 these are empty-state stubs reading from sim queries that T4/T5 will populate.
  // We keep them as pure functions so later tickets just replace internals without changing UI contract.
  const wars: Array<{ id: string; label: string }> = [];
  const constructions: Array<{ id: string; label: string }> = [];
  // treasury/balance placeholder — T4 will provide sim.getEconomy(countryId)
  const treasury: number | null = null;
  const balance: number | null = null;
  // expose sim for direct eventLog
  return { sim, wars, constructions, treasury, balance };
}
