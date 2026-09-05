import { useEffect, useRef } from "react";
import { useGameStore } from "./store.js";
import ru from "./locales/ru.json";

export default function App() {
  const { sim, speed, isPaused, setSpeed, togglePause, tickReal } = useGameStore();
  const date = useGameStore((s) => s.lastDate);
  const events = sim.getEventLogTail(8);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      // clamp dt to avoid spiral on tab wake
      const clamped = Math.min(dt, 0.2);
      tickReal(clamped);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tickReal]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <h1>{(ru as Record<string, string>)["app.title"]}</h1>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          border: "1px solid #ddd",
          padding: 12,
          borderRadius: 8,
        }}
      >
        <div>
          <strong>{(ru as Record<string, string>)["topbar.date"]}:</strong> {date}
        </div>
        <div>
          <strong>{(ru as Record<string, string>)["topbar.speed"]}:</strong> {isPaused ? "пауза" : speed} ({speed !== "paused" ? `${{ slow: 1, normal: 3, fast: 7 }[speed as "slow" | "normal" | "fast"]} дн/сек` : "0 дн/сек"})
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={togglePause}>{isPaused ? "Продолжить" : (ru as Record<string, string>)["controls.pause"]}</button>
          <button onClick={() => setSpeed("slow")} disabled={speed === "slow" && !isPaused}>
            {(ru as Record<string, string>)["controls.slow"]}
          </button>
          <button onClick={() => setSpeed("normal")} disabled={speed === "normal" && !isPaused}>
            {(ru as Record<string, string>)["controls.normal"]}
          </button>
          <button onClick={() => setSpeed("fast")} disabled={speed === "fast" && !isPaused}>
            {(ru as Record<string, string>)["controls.fast"]}
          </button>
        </div>
        <div style={{ marginLeft: "auto", opacity: 0.7 }}>
          seed {sim.getSeed()} · {sim.getDaysElapsed()} дн. прошло · тиков {sim.getTickCount()}
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minHeight: 280 }}>
          <h3 style={{ marginTop: 0 }}>{(ru as Record<string, string>)["map.placeholder"]}</h3>
          <p style={{ opacity: 0.7 }}>
            T1: каркас и ядро симуляции работают. Карта PixiJS появится в T3. Сейчас проверяется время (пауза + 3 скорости
            через fixed-timestep), календарь с 01.01.2026, seeded RNG и журнал событий.
          </p>
          <p>
            Попробуйте команды (скелет валидатора):{" "}
            <button
              onClick={() => {
                const r = sim.dispatch({ type: "testPing", payload: { message: "hello T1" } });
                console.log("dispatch testPing", r, sim.getEventLogTail(2));
              }}
            >
              testPing
            </button>{" "}
            <button
              onClick={() => {
                const r = sim.dispatch({ type: "incrementCounter", payload: { key: "demo", delta: 1 } });
                console.log("incrementCounter", r, sim.getCustomState());
              }}
            >
              incrementCounter demo+1
            </button>{" "}
            <button
              onClick={() => {
                const r = sim.dispatch({ type: "unknownType" } as unknown as { type: string });
                console.log("unknown rejected", r);
              }}
            >
              unknown (отклонится)
            </button>
          </p>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            customState: {JSON.stringify(sim.getCustomState())} · log size {sim.getEventLog().length}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>{(ru as Record<string, string>)["eventLog.title"]}</h3>
          <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {events.length === 0 ? (
              <em>пока пусто</em>
            ) : (
              [...events].reverse().map((e) => (
                <div key={e.id} style={{ borderBottom: "1px solid #eee", paddingBottom: 4 }}>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    #{e.id} · {e.date} · {e.kind}
                  </div>
                  <div>{e.message ?? JSON.stringify(e.payload)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 13, opacity: 0.75 }}>
        <strong>Что работает в T1:</strong> календарь (день=базовый шаг), пауза+3 скорости через аккумулятор (частота кадров не
        влияет), seeded RNG (mulberry32), валидатор команд и журнал событий, структура <code>sim/</code> / <code>data/</code> /{" "}
        <code>rules/</code> / <code>map/</code> / <code>ui/</code>. Сценарий, карта, экономика и пр. — в следующих тикетах.
      </div>
    </div>
  );
}
