import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.js";
import { getProfileForCountry } from "../data/countryProfiles.js";
import { loadScenario } from "../../sim/scenario.js";
import { useGameStore } from "../store.js";

// jsdom lacks ResizeObserver and canvas getContext for Pixi; our MapCanvas fallbacks gracefully.
if (typeof globalThis.ResizeObserver === "undefined") {
  // @ts-ignore
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof HTMLCanvasElement !== "undefined") {
  const orig = HTMLCanvasElement.prototype.getContext;
  // @ts-ignore
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
    if (type === "2d") {
      return {
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: [] }),
        putImageData: () => {},
        createImageData: () => [],
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        fillText: () => {},
        measureText: () => ({ width: 0 }),
      } as unknown as CanvasRenderingContext2D;
    }
    // @ts-ignore
    return orig ? orig.call(this, type) : null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

describe("grand-strategy shell: map + UI", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    const s = useGameStore.getState();
    s.selectCountry(null);
    s.selectRegion(null);
    s.setMapMode("political");
    // @ts-ignore
    useGameStore.setState({ playerCountryId: null, hasStarted: false, selectedCountryId: null, selectedRegionId: null, activeSection: "overview", showMenu: false, showEventLog: true, isDevMode: false, stateRev: 0 });
    s.setSpeed("normal");
  });

  it("renders shell, topbar date and map canvas behind start veil", async () => {
    render(<App />);
    expect(screen.getByTestId("gs-shell")).toBeTruthy();
    expect(screen.getByText(/World Balance/)).toBeTruthy();
    expect(screen.getByTestId("topbar")).toBeTruthy();
    expect(screen.getByTestId("map-canvas")).toBeTruthy();
    // start veil with country selection overlays the map before start
    expect(screen.getByTestId("country-selection")).toBeTruthy();
  });

  it("shows country selection with 16 cards and strengths/risks after selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("country-selection")).toBeTruthy();
    const sc = loadScenario();
    for (const c of sc.countries) {
      expect(screen.getByTestId(`country-card-${c.countryId}`)).toBeTruthy();
    }
    await user.click(screen.getByTestId("country-card-DE"));
    expect(screen.getAllByText(/Положение:/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Сильные стороны").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Риски").length).toBeGreaterThanOrEqual(1);
    const profile = getProfileForCountry(sc.countries.find((c) => c.countryId === "DE")!);
    expect(screen.getAllByText(profile.strengths[0]).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("btn-start-game")).toBeTruthy();
  });

  it("map modes switchable via aria-pressed", async () => {
    const user = userEvent.setup();
    render(<App />);
    const political = screen.getByTestId("btn-mode-political");
    const military = screen.getByTestId("btn-mode-military");
    expect(political.getAttribute("aria-pressed")).toBe("true");
    await user.click(military);
    expect(military.getAttribute("aria-pressed")).toBe("true");
    await user.click(political);
    expect(political.getAttribute("aria-pressed")).toBe("true");
  });

  it("topbar separates player summary from selection and labels war scopes", async () => {
    const user = userEvent.setup();
    render(<App />);
    // До старта — прочерки, после старта — своя страна
    expect(screen.getByTestId("topbar-player").textContent).toContain("—");
    await user.click(screen.getByTestId("country-card-DE"));
    await user.click(screen.getByTestId("btn-start-game"));
    expect(screen.getByTestId("topbar-player").textContent).toContain("DE");
    // Счётчики с областью действия
    expect(screen.getByTestId("wars-indicator").textContent).toContain("Ваши войны");
    expect(screen.getByTestId("world-wars-indicator").textContent).toContain("В мире");
    expect(screen.getByTestId("constructions-indicator").textContent).toContain("Стройки");
    // Технические seed/тики скрыты без DEV
    expect(screen.queryByText(/тиков/)).toBeNull();
    // Выбор чужой страны не подменяет сводку игрока
    useGameStore.getState().selectCountry("FR");
    expect(screen.getByTestId("topbar-player").textContent).toContain("DE");
  });

  it("no legacy T4/T5/T6 stubs next to functional panels", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("country-card-DE"));
    await user.click(screen.getByTestId("btn-start-game"));
    // Старые заглушки удалены
    expect(screen.queryByText("Открыть экономику — в T4")).toBeNull();
    expect(screen.queryByText("Открыть армию — в T5")).toBeNull();
    expect(screen.queryByText(/Дипломатия войны — в T6/)).toBeNull();
    expect(screen.queryByText("testPing")).toBeNull();
    // Навигация по разделам показывает только активный
    await user.click(screen.getByTestId("nav-economy"));
    expect(screen.getByText(/Экономика — DE/)).toBeTruthy();
    expect(screen.queryByTestId("war-panel")).toBeNull();
    await user.click(screen.getByTestId("nav-diplomacy"));
    expect(screen.getByTestId("war-panel")).toBeTruthy();
  });

  it("country profiles provide strengths/risks for landlocked/island", async () => {
    const sc = loadScenario();
    const gb = sc.countries.find((c) => c.countryId === "GB")!;
    const cz = sc.countries.find((c) => c.countryId === "CZ")!;
    const gbP = getProfileForCountry(gb);
    const czP = getProfileForCountry(cz);
    expect(gbP.risks.join(" ")).toMatch(/переправ/);
    expect(czP.risks.join(" ")).toMatch(/Landlocked|landlocked|море/);
    expect(gbP.strengths.length).toBeGreaterThanOrEqual(2);
    expect(czP.strengths.length).toBeGreaterThanOrEqual(2);
  });

  it("event log appears after start and command on pause bumps stateRev without date change", async () => {
    const user = userEvent.setup();
    render(<App />);
    // До старта журнала-оверлея нет
    expect(screen.queryByTestId("event-log")).toBeNull();
    await user.click(screen.getByTestId("country-card-PL"));
    await user.click(screen.getByTestId("btn-start-game"));
    expect(screen.getByTestId("event-log")).toBeTruthy();
    expect(screen.getByText("Журнал событий")).toBeTruthy();
    // Пауза + команда в тот же день: ревизия растёт, дата та же
    const st = useGameStore.getState();
    st.setSpeed("paused");
    const dateBefore = st.sim.getDate();
    const revBefore = useGameStore.getState().stateRev;
    st.dispatch({ type: "setTax", payload: { countryId: "PL", taxRate: 0.3 } });
    expect(useGameStore.getState().sim.getDate()).toBe(dateBefore);
    expect(useGameStore.getState().stateRev).toBeGreaterThan(revBefore);
  });

  it("time does not flow before start", async () => {
    render(<App />);
    const st = useGameStore.getState();
    const daysBefore = st.sim.getDaysElapsed();
    st.tickReal(5);
    expect(st.sim.getDaysElapsed()).toBe(daysBefore);
  });

  it("selection syncs with store and start keeps map modes working", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("country-card-PL"));
    expect(screen.getByTestId("selected-country-label").textContent).toContain("Польша");
    await user.click(screen.getByTestId("btn-start-game"));
    expect(screen.getByTestId("btn-mode-political")).toBeTruthy();
  });

  it("declaring war requires explicit confirmation and is blocked for foreign attacker", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("country-card-GB"));
    await user.click(screen.getByTestId("btn-start-game"));
    await user.click(screen.getByTestId("nav-diplomacy"));
    // Без галочки война не объявляется
    await user.click(screen.getByTestId("btn-declare-war"));
    expect(useGameStore.getState().sim.getWarsSnapshot().filter((w) => w.status === "active").length).toBe(0);
    // С галочкой — объявляется от своей страны
    await user.click(screen.getByTestId("war-confirm"));
    await user.click(screen.getByTestId("btn-declare-war"));
    const wars = useGameStore.getState().sim.getWarsSnapshot().filter((w) => w.status === "active");
    expect(wars.length).toBe(1);
    expect(wars[0].attackerId).toBe("GB");
  });
});
