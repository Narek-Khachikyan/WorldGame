import { create } from "zustand";
import { createSim, TimeAccumulator, DEFAULT_SPEED, type Speed } from "../sim/index.js";
import type { SimEngine } from "../sim/engine.js";
import { loadScenario, type Scenario } from "../sim/scenario.js";

export type MapMode = "political" | "military";

interface GameStore {
  sim: SimEngine;
  scenario: Scenario;
  speed: Speed;
  isPaused: boolean;
  accumulator: TimeAccumulator;
  lastDate: string;
  // map / selection
  mapMode: MapMode;
  selectedCountryId: string | null;
  selectedRegionId: string | null;
  playerCountryId: string | null;
  hasStarted: boolean;
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
}

let _prevSpeed: Speed = DEFAULT_SPEED;

// scenario is static offline data — load once synchronously (throws if invalid, which is fail-fast)
let _scenario: Scenario | null = null;
function getScenario(): Scenario {
  if (!_scenario) _scenario = loadScenario();
  return _scenario;
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
        st.sim.tick(days);
        set({ lastDate: st.sim.getDate() });
      }
    },
    dispatch: (cmd) => {
      const st = get();
      const res = st.sim.dispatch(cmd);
      set({ lastDate: st.sim.getDate() });
      return res;
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
        return;
      }
      const st = get();
      if (!st.scenario.countries.some((c) => c.countryId === id)) return;
      set({ playerCountryId: id });
    },
    startGame: (countryId) => {
      const st = get();
      if (!st.scenario.countries.some((c) => c.countryId === countryId)) return;
      set({
        playerCountryId: countryId,
        selectedCountryId: countryId,
        selectedRegionId: null,
        hasStarted: true,
      });
    },
    resetSelection: () => set({ selectedCountryId: null, selectedRegionId: null }),
  };
});

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
