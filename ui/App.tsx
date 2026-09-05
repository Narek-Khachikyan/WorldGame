import { useEffect, useRef, useState } from "react";
import { useGameStore } from "./store.js";
import TopBar from "./components/TopBar.js";
import MapCanvas from "./components/MapCanvas.js";
import GameNav from "./components/GameNav.js";
import SidePanel from "./components/SidePanel.js";
import EventLog from "./components/EventLog.js";
import CountrySelection from "./components/CountrySelection.js";
import EconomyPanel from "./EconomyPanel.js";
import ArmyPanel from "./ArmyPanel.js";
import WarPanel from "./panels/WarPanel.js";
import PoliticsPanel from "./panels/PoliticsPanel.js";
import SavePanel from "./panels/SavePanel.js";
import "./styles/atlas.css";

const SECTION_TITLES: Record<string, { title: string; sub: string }> = {
  overview: { title: "Обзор", sub: "контекст карты" },
  economy: { title: "Экономика", sub: "ваша страна" },
  army: { title: "Армия", sub: "ваши войска" },
  politics: { title: "Политика", sub: "ваша страна" },
  diplomacy: { title: "Дипломатия", sub: "война и мир" },
};

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
  const activeSection = useGameStore((s) => s.activeSection);
  const setActiveSection = useGameStore((s) => s.setActiveSection);
  const showEventLog = useGameStore((s) => s.showEventLog);
  const toggleEventLog = useGameStore((s) => s.toggleEventLog);
  const showMenu = useGameStore((s) => s.showMenu);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const isDevMode = useGameStore((s) => s.isDevMode);
  useGameStore((s) => s.lastDate);
  useGameStore((s) => s.stateRev);

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const menuCloseRef = useRef<HTMLButtonElement>(null);

  // fixed-timestep loop (store gates time before start)
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

  // keyboard: Space — пауза в игровом контексте; Esc — закрыть верхнее окно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t.isContentEditable
      );
      if (e.code === "Escape") {
        const st = useGameStore.getState();
        if (st.showMenu) { st.setMenuOpen(false); setConfirmRestart(false); return; }
        return;
      }
      if (e.code === "Space" && !inField) {
        // Не перехватываем Space на кнопках/ссылках и пока игра не стартовала или открыто меню.
        const st = useGameStore.getState();
        if (!st.hasStarted || st.showMenu) return;
        if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) return;
        e.preventDefault();
        st.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // focus management for menu modal
  useEffect(() => {
    if (showMenu) {
      const id = requestAnimationFrame(() => menuCloseRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [showMenu]);

  // Живые слои карты из симуляции (владелец/контролёр + армии).
  let regionStates: Array<{ regionId: string; ownerId: string; controllerId: string }> = [];
  let units: Array<{ unitId: string; countryId: string; regionId: string; personnel: number; readiness: number }> = [];
  try {
    regionStates = sim.getRegionStates().map((r) => ({ regionId: r.regionId, ownerId: r.ownerId, controllerId: r.controllerId }));
    units = sim.getUnits().map((u) => ({ unitId: u.unitId, countryId: u.countryId, regionId: u.regionId, personnel: u.personnel, readiness: u.readiness }));
  } catch { /* sim not ready */ }

  const section = SECTION_TITLES[activeSection] ?? SECTION_TITLES.overview;
  const economyCountryId = playerCountryId ?? scenario.countries[0]?.countryId ?? null;

  return (
    <div className="gs-shell" data-testid="gs-shell">
      <TopBar onOpenMenu={() => setMenuOpen(true)} />

      <div className="gs-main">
        <GameNav
          active={activeSection}
          onChange={setActiveSection}
          onToggleLog={toggleEventLog}
          logOpen={showEventLog}
          onToggleSide={() => setSideOpen((v) => !v)}
          sideOpen={sideOpen}
        />

        {/* карта — основное рабочее пространство */}
        <div className="gs-mapwrap">
          <MapCanvas
            scenario={scenario}
            selectedCountryId={selectedCountryId}
            selectedRegionId={selectedRegionId}
            mapMode={mapMode}
            playerCountryId={playerCountryId}
            regionStates={regionStates}
            units={units}
            onSelectCountry={selectCountry}
            onSelectRegion={selectRegion}
          />

          {/* режимы карты поверх карты */}
          <div className="gs-overlay-tl">
            <div className="gs-float gs-mode-switch" role="group" aria-label="Режим карты">
              <button
                onClick={() => setMapMode("political")}
                data-testid="btn-mode-political"
                className="gs-btn small"
                aria-pressed={mapMode === "political"}
              >
                Политический
              </button>
              <button
                onClick={() => setMapMode("military")}
                data-testid="btn-mode-military"
                className="gs-btn small"
                aria-pressed={mapMode === "military"}
                title="Военный слой: реальные армии и оккупация из симуляции"
              >
                Военный
              </button>
              {hasStarted && playerCountryId && (
                <span className="gs-faint" style={{ marginLeft: 4 }}>
                  Играете за <strong style={{ color: "var(--gs-brass-soft)" }}>{scenario.countries.find((c) => c.countryId === playerCountryId)?.nameRu}</strong>
                </span>
              )}
            </div>
          </div>

          {mapMode === "military" && (
            <div className="gs-overlay-tr">
              <div className="gs-float" style={{ maxWidth: 220 }}>
                <strong>Военный слой</strong>
                <div className="gs-faint" style={{ marginTop: 2 }}>
                  Кружки — реальные отряды (размер — численность). Красная рамка — оккупирован (контролёр ≠ владелец).
                </div>
              </div>
            </div>
          )}

          {showEventLog && hasStarted && (
            <div className="gs-overlay-bl">
              <EventLog compact />
            </div>
          )}

          {/* стартовое состояние поверх карты */}
          {!hasStarted && (
            <div className="gs-start-veil" role="dialog" aria-modal="true" aria-label="Выбор страны">
              <div className="gs-start-card">
                <CountrySelection
                  scenario={scenario}
                  onPick={(id) => startGame(id)}
                  onViewOnMap={(id) => selectCountry(id)}
                />
              </div>
            </div>
          )}
        </div>

        {/* контекстная панель — только активный раздел */}
        {sideOpen && (
          <aside className="gs-side" aria-label={`Панель: ${section.title}`} data-collapsed="false">
            <div className="gs-side-head">
              <h2>{section.title}</h2>
              <span className="sub">{section.sub}</span>
              {selectedCountryId && activeSection === "overview" && (
                <button
                  className="gs-btn small ghost"
                  style={{ marginLeft: "auto" }}
                  onClick={() => { selectCountry(null); }}
                  title="Сбросить выбор страны/региона"
                >
                  Сбросить
                </button>
              )}
            </div>
            <div className="gs-side-body">
              {activeSection === "overview" && <SidePanel onGotoDiplomacy={() => setActiveSection("diplomacy")} />}
              {activeSection === "economy" && (
                economyCountryId ? (
                  <>
                    {selectedCountryId && selectedCountryId !== economyCountryId && (
                      <div className="gs-card"><span className="gs-muted">Просмотр {selectedCountryId} не меняет экономику: ниже — ваша страна ({economyCountryId}).</span></div>
                    )}
                    <EconomyPanel sim={sim} countryId={economyCountryId} />
                  </>
                ) : <div className="gs-card">Выберите страну для экономики</div>
              )}
              {activeSection === "army" && <ArmyPanel playerCountryId={playerCountryId} />}
              {activeSection === "politics" && (
                economyCountryId ? <PoliticsPanel countryId={economyCountryId} /> : <div className="gs-card">Нет данных политики</div>
              )}
              {activeSection === "diplomacy" && <WarPanel playerCountryId={playerCountryId} selectedCountryId={selectedCountryId} />}

              {isDevMode && (
                <div className="gs-card">
                  <h3>DEV · техническое</h3>
                  <div className="gs-faint">seed {sim.getSeed()} · {sim.getDaysElapsed()} дн · тиков {sim.getTickCount()} · {scenario.scenarioId} v{scenario.version}</div>
                  <div className="gs-row" style={{ marginTop: 6 }}>
                    <button
                      className="gs-btn small"
                      onClick={() => {
                        const r = sim.dispatch({ type: "testPing", payload: { message: "hello map" } });
                        console.log("testPing", r);
                      }}
                      title="Проверка валидатора и журнала"
                    >
                      testPing
                    </button>
                    <button className="gs-btn small ghost" onClick={() => { selectCountry(null); selectRegion(null); }}>
                      Сбросить выбор
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* игровое меню: сохранения + новая игра */}
      {showMenu && (
        <div className="gs-modal-veil" onClick={() => { setMenuOpen(false); setConfirmRestart(false); }}>
          <div
            className="gs-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Игровое меню"
            data-testid="game-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gs-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>Меню</h2>
              <button ref={menuCloseRef} className="gs-btn small" onClick={() => { setMenuOpen(false); setConfirmRestart(false); }} data-testid="btn-menu-close">
                Закрыть (Esc)
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <SavePanel />
              <div className="gs-card">
                <h3>Новая игра</h3>
                {!confirmRestart ? (
                  <>
                    <div className="gs-muted">Начать заново поверх текущей партии.</div>
                    <div style={{ marginTop: 8 }}>
                      <button className="gs-btn" onClick={() => setConfirmRestart(true)} data-testid="btn-new-game">
                        Новая игра…
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="gs-muted">Текущая партия будет потеряна, если не сохранена. Продолжить?</div>
                    <div className="gs-row" style={{ marginTop: 8 }}>
                      <button
                        className="gs-btn primary"
                        data-testid="btn-new-game-confirm"
                        onClick={() => {
                          // Возврат к выбору страны без затирания сима до явного старта.
                          useGameStore.setState({ hasStarted: false, playerCountryId: null, selectedCountryId: null, selectedRegionId: null, activeSection: "overview" });
                          try { sim.setPlayerCountryId(null); } catch { /* noop */ }
                          setConfirmRestart(false);
                          setMenuOpen(false);
                        }}
                      >
                        Да, к выбору страны
                      </button>
                      <button className="gs-btn ghost" onClick={() => setConfirmRestart(false)}>
                        Отмена
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
