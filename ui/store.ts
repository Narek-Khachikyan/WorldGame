import { create } from "zustand";
import { createSim, TimeAccumulator, DEFAULT_SPEED, type Speed } from "../sim/index.js";
import type { SimEngine } from "../sim/engine.js";

interface GameStore {
  sim: SimEngine;
  speed: Speed;
  isPaused: boolean;
  accumulator: TimeAccumulator;
  lastDate: string;
  setSpeed: (s: Speed) => void;
  togglePause: () => void;
  tickReal: (deltaSeconds: number) => void;
  dispatch: (cmd: import("../sim/types.js").Command) => import("../sim/types.js").ValidationResult;
}

let _prevSpeed: Speed = DEFAULT_SPEED;

export const useGameStore = create<GameStore>((set, get) => {
  const sim = createSim({ seed: 42 });
  const acc = new TimeAccumulator(DEFAULT_SPEED);
  return {
    sim,
    speed: DEFAULT_SPEED,
    isPaused: false,
    accumulator: acc,
    lastDate: sim.getDate(),
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
  };
});
