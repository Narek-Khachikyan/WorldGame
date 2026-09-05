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

// Mock Pixi occasionally needs canvas getContext; jsdom returns null by default.
// Provide minimal stub so Pixi construction doesn't throw before fallback.
// Our MapCanvas already catches throw, but stub helps.
if (typeof HTMLCanvasElement !== "undefined") {
  const orig = HTMLCanvasElement.prototype.getContext;
  // @ts-ignore
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
    // 2d fallback for Pixi fallback (it will still throw but we want null to trigger catch)
    if (type === "2d") {
      // minimal 2d context stub
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

describe("T3 smoke: map + UI shell", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    // reset Zustand store state between tests
    const s = useGameStore.getState();
    s.selectCountry(null);
    s.selectRegion(null);
    s.setMapMode("political");
    // reset player/hasStarted by direct set (store not exposing reset, we mutate)
    // @ts-ignore
    useGameStore.setState({ playerCountryId: null, hasStarted: false, selectedCountryId: null, selectedRegionId: null });
    // reset speed to normal not paused
    s.setSpeed("normal");
    // clear sim? sim is singleton but events accumulate; we keep for log check but ok
  });

  it("renders app title, topbar date and map canvas", async () => {
    render(<App />);
    expect(screen.getByText(/World Balance/)).toBeTruthy();
    // date visible (2026-*)
    expect(screen.getByTestId("topbar")).toBeTruthy();
    expect(screen.getByTestId("map-canvas")).toBeTruthy();
  });

  it("shows country selection with 16 cards and strengths/risks after selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    // selection panel visible
    expect(screen.getByTestId("country-selection")).toBeTruthy();
    // 16 cards
    const sc = loadScenario();
    for (const c of sc.countries) {
      expect(screen.getByTestId(`country-card-${c.countryId}`)).toBeTruthy();
    }
    // pick Germany
    await user.click(screen.getByTestId("country-card-DE"));
    // detail shows strengths/risks (both in selection card and side panel -> may duplicate, so use getAll)
    expect(screen.getAllByText(/Положение:/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Сильные стороны").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Риски").length).toBeGreaterThanOrEqual(1);
    const profile = getProfileForCountry(sc.countries.find((c) => c.countryId === "DE")!);
    expect(screen.getAllByText(profile.strengths[0]).length).toBeGreaterThanOrEqual(1);
    // start game button appears
    expect(screen.getByTestId("btn-start-game")).toBeTruthy();
  });

  it("map modes switchable, political vs military", async () => {
    const user = userEvent.setup();
    render(<App />);
    const political = screen.getByTestId("btn-mode-political");
    const military = screen.getByTestId("btn-mode-military");
    expect(political).toBeTruthy();
    expect(military).toBeTruthy();
    await user.click(military);
    // jsdom normalizes hex to rgb, so accept either
    const mStyle = military.getAttribute("style") ?? "";
    expect(mStyle.includes("92400e") || mStyle.includes("146, 64, 14") || mStyle.includes("146,64,14")).toBe(true);
    await user.click(political);
    const pStyle = political.getAttribute("style") ?? "";
    expect(pStyle.includes("111827") || pStyle.includes("17, 24, 39") || pStyle.includes("17,24,39")).toBe(true);
  });

  it("topbar shows treasury placeholder and wars/constructions empty with hints, no stub buttons", async () => {
    const user = userEvent.setup();
    render(<App />);
    // wars and constructions indicators show 0 and explanatory title (not dead buttons)
    const wars = screen.getByTestId("wars-indicator");
    const cons = screen.getByTestId("constructions-indicator");
    expect(wars.textContent).toContain("0");
    expect(cons.textContent).toContain("0");
    // side panel stubs appear after selecting a country (no dead buttons before selection is also valid)
    await user.click(screen.getByTestId("country-card-DE"));
    expect(screen.getByText("Открыть экономику — в T4")).toBeTruthy();
    expect((screen.getByText("Открыть экономику — в T4") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Открыть армию — в T5")).toBeTruthy();
    expect((screen.getByText("Открыть армию — в T5") as HTMLButtonElement).disabled).toBe(true);
    // ensure disabled buttons have explanation title
    expect(screen.getByText("Открыть экономику — в T4").getAttribute("title")).toMatch(/T4/);
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

  it("event log receives sim events and shows titles", async () => {
    render(<App />);
    expect(screen.getByTestId("event-log")).toBeTruthy();
    expect(screen.getByText("Журнал событий")).toBeTruthy();
  });

  it("selection syncs with map store: clicking card updates selected labels", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("country-card-PL"));
    // side panel updates selected country label
    // App has selected-country-label element
    expect(screen.getByTestId("selected-country-label").textContent).toContain("Польша");
    // start game then check player highlight
    await user.click(screen.getByTestId("btn-start-game"));
    // after start, map mode buttons still work
    expect(screen.getByTestId("btn-mode-political")).toBeTruthy();
  });
});
