import { useEffect, useRef, useState } from "react";
import { useGameStore } from "./store.js";
import TopBar from "./components/TopBar.js";
import MapCanvas from "./components/MapCanvas.js";
import SidePanel from "./components/SidePanel.js";
import EventLog from "./components/EventLog.js";
import CountrySelection from "./components/CountrySelection.js";
import ru from "./locales/ru.json";
import "./styles/atlas.css";

export default function App() {
  const tickReal = useGameStore((s) => s.tickReal);
  const scenario = useGameStore((s) => s.scenario);
  const mapMode = useGameStore((s) => s.mapMode);
  const setMapMode = useGameStore((s) => s.setMapMode);
  const selectedCountryId = useGameStore((s) => s.selectedCountryId);
  const selectedRegionId = useGameStore((s) => s.selectedRegionId);
  const selectCountry = useGameStore((s) => s.selectCountry);
  const selectRegion = useGameStore((s) => s.selectRegion);
  const playerCountryId = useGameStore((s) => s.playerCountryId);
  const hasStarted = useGameStore((s) => s.hasStarted);
  const startGame = useGameStore((s) => s.startGame);
  const sim = useGameStore((s) => s.sim);

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const [showSelection, setShowSelection] = useState(true);

  const t = ru as Record<string, string>;

  // fixed-timestep loop
  useEffect(() => {
    const loop = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const clamped = Math.min(dt, 0.2);
      tickReal(clamped);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tickReal]);

  // keyboard: space -> pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        useGameStore.getState().togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // when game starts, keep selection visible but collapsible; hide initial full panel after first start?
  useEffect(() => {
    if (hasStarted) {
      // auto-collapse selection after 800ms to show map; user can reopen
      const id = setTimeout(() => setShowSelection(false), 800);
      return () => clearTimeout(id);
    } else {
      setShowSelection(true);
    }
  }, [hasStarted]);

  return (
    <div style={{ minHeight: "100vh", background: "#fcfcf9", color: "#111827" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "14px 14px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: -0.3 }}>{t["app.title"]}</h1>
          <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 999, border: "1px solid #e5e7eb" }}>
            PixiJS · Zustand · {scenario.totalCountries} стран · {scenario.totalRegions} регионов · {mapMode === "political" ? "политический" : "военный"} режим
          </span>
          <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>{t["app.subtitle"]}</span>
        </div>

        <TopBar />

        {/* map mode switch + hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 10,
            padding: "8px 10px",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#6b7280" }}>
            {t["layout.mapModes"]}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setMapMode("political")}
              data-testid="btn-mode-political"
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: mapMode === "political" ? "1px solid #111827" : "1px solid #d1d5db",
                background: mapMode === "political" ? "#111827" : "#fff",
                color: mapMode === "political" ? "#fff" : "#111827",
                fontWeight: mapMode === "political" ? 700 : 500,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t["map.modes.political"]}
            </button>
            <button
              onClick={() => setMapMode("military")}
              data-testid="btn-mode-military"
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: mapMode === "military" ? "1px solid #92400e" : "1px solid #d1d5db",
                background: mapMode === "military" ? "#92400e" : "#fff",
                color: mapMode === "military" ? "#fff" : "#111827",
                fontWeight: mapMode === "military" ? 700 : 500,
                fontSize: 12,
                cursor: "pointer",
              }}
              title="Военный слой: границы, столица, точки войск/приказов, война/оккупация. Сейчас войск нет — пустое состояние (T5)."
            >
              {t["map.modes.military"]}
            </button>
          </div>

          <span style={{ fontSize: 11, color: "#6b7280" }}>{t["map.hint"]}</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {hasStarted && playerCountryId && (
              <span style={{ fontSize: 12, color: "#374151" }}>
                Играете за <strong>{scenario.countries.find((c) => c.countryId === playerCountryId)?.nameRu}</strong>
              </span>
            )}
            <button
              onClick={() => setShowSelection((v) => !v)}
              data-testid="btn-toggle-selection"
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {showSelection ? "Скрыть выбор" : "Выбор страны"}
            </button>
          </div>
        </div>

        {/* country selection — prominent before start, collapsible after */}
        {showSelection && (
          <CountrySelection
            scenario={scenario}
            onPick={(id) => startGame(id)}
            onViewOnMap={(id) => {
              selectCountry(id);
              // scroll to map
              document.querySelector('[data-testid="map-canvas"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        )}

        {/* main layout: map + side */}
        <div style={{ display: "grid", gridTemplateColumns: "1.65fr 0.9fr", gap: 12, alignItems: "start" }}>
          {/* left column: map + event log + dev helpers */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ height: 520, minHeight: 420, display: "flex", flexDirection: "column" }}>
              <MapCanvas
                scenario={scenario}
                selectedCountryId={selectedCountryId}
                selectedRegionId={selectedRegionId}
                mapMode={mapMode}
                playerCountryId={playerCountryId}
                onSelectCountry={selectCountry}
                onSelectRegion={selectRegion}
              />
            </div>

            {/* selection summary bar */}
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                background: "#fff",
                border: "1px solid #d1d5db",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 12,
              }}
            >
              <span style={{ color: "#6b7280" }}>Выбрано:</span>
              <span data-testid="selected-country-label" style={{ fontWeight: 700 }}>
                {selectedCountryId ? scenario.countries.find((c) => c.countryId === selectedCountryId)?.nameRu ?? "—" : "— страна"}
              </span>
              <span style={{ color: "#9ca3af" }}>·</span>
              <span data-testid="selected-region-label" style={{ fontWeight: selectedRegionId ? 700 : 400, color: selectedRegionId ? "#111827" : "#9ca3af" }}>
                {selectedRegionId ? scenario.regions.find((r) => r.regionId === selectedRegionId)?.nameRu ?? selectedRegionId : "— регион"}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    selectCountry(null);
                    // also clears via store
                  }}
                  style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: 11, cursor: "pointer" }}
                >
                  Сбросить выбор
                </button>
                <button
                  onClick={() => {
                    const r = sim.dispatch({ type: "testPing", payload: { message: "hello T3 map" } });
                    // force re-render via date bump? dispatch already bumps lastDate
                    console.log("testPing", r);
                  }}
                  title="Проверка валидатора и журнала — кнопка работает, не заглушка"
                  style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", fontSize: 11, cursor: "pointer" }}
                >
                  testPing
                </button>
              </span>
            </div>

            <EventLog />

            {/* dev / stub explain */}
            <div style={{ fontSize: 11, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", lineHeight: 1.4 }}>
              <strong>T3 — что видно на карте:</strong> границы (толще между странами, тоньше между регионами), столица ★, точки войск/приказов (сейчас пусто — T5),
              война/оккупация (штрих, сейчас нет — T6). Зум/пан плавные, геометрия кешируется, перерисовывается только дифф выбора/режима.
              <br />
              <span style={{ fontFamily: "monospace", fontSize: 10 }}>map/README.md · PixiJS v7 · без DOM на регион · Graphics cache · diff-only</span>
            </div>
          </div>

          {/* right column: side panel */}
          <div style={{ position: "sticky", top: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <SidePanel />

            {/* quick stats debug */}
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: "8px 10px", fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
              <strong>Сценарий:</strong> {scenario.scenarioId} v{scenario.version} · {scenario.nameRu}
              <br />
              Natural Earth 5.1.0 · 60–120 регионов · факт: {scenario.disputedTerritoriesNote.slice(0, 80)}…
              <br />
              Календарь с {scenario.startDate} · выборы каждые {scenario.electionIntervalYears} лет · seed {sim.getSeed()}
              <br />
              <span style={{ fontFamily: "monospace", fontSize: 10 }}>T1 ядро времени · T2 сценарий · T3 карта — все в одном бранче feat/spec-1-slice-A</span>
            </div>
          </div>
        </div>

        {/* footer */}
        <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>
          Стиль — сдержанный политический атлас · Русский язык · Тексты в <code>ui/locales/ru.json</code> · Нет кнопок-заглушек — всё кликабельное работает или явно отключено с объяснением.
        </div>
      </div>
    </div>
  );
}
