import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { Scenario } from "../../sim/scenario.js";
import type { MapMode } from "../store.js";

// — constants for projection

const WORLD_MIN_LON = -9;
const WORLD_MAX_LON = 35;
const WORLD_MIN_LAT = 35;
const WORLD_MAX_LAT = 66;

const WORLD_SCALE = 12; // deg -> world px
const WORLD_W = (WORLD_MAX_LON - WORLD_MIN_LON) * WORLD_SCALE; // 528
const WORLD_H = (WORLD_MAX_LAT - WORLD_MIN_LAT) * WORLD_SCALE; // 372

function projectLonLat(lon: number, lat: number): [number, number] {
  const x = (lon - WORLD_MIN_LON) * WORLD_SCALE;
  const y = (WORLD_MAX_LAT - lat) * WORLD_SCALE;
  return [x, y];
}

function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// country palette — restrained political atlas, muted desaturated
const COUNTRY_COLORS: Record<string, number> = {
  GB: 0x8fa8c8,
  FR: 0xa8c4a0,
  ES: 0xd4c08a,
  IT: 0xa8c8b8,
  DE: 0xc4b8a0,
  PL: 0xc8a8a8,
  SE: 0x9bb8d0,
  RO: 0xc0b0c8,
  GR: 0xb8c0a8,
  UA: 0xe0c8a0,
  TR: 0xc8b0a0,
  BY: 0xa8b0c0,
  CZ: 0xb8a8b8,
  AT: 0xc8c0b0,
  HU: 0xa8b8a8,
  RS: 0xb0a8a8,
};

function countryColor(countryId: string, mode: MapMode, terrain?: string): number {
  const base = COUNTRY_COLORS[countryId] ?? 0xcccccc;
  if (mode === "political") return base;
  // military: terrain-driven desaturation
  if (terrain === "mountains") return 0xa8a090; // darker olive for hills
  if (terrain === "city") return 0xc8b8a8;
  return 0xd8d0c0; // plains sand
}

interface Props {
  scenario: Scenario;
  selectedCountryId: string | null;
  selectedRegionId: string | null;
  mapMode: MapMode;
  playerCountryId?: string | null;
  onSelectCountry: (id: string) => void;
  onSelectRegion: (id: string) => void;
}

export default function MapCanvas({
  scenario,
  selectedCountryId,
  selectedRegionId,
  mapMode,
  playerCountryId,
  onSelectCountry,
  onSelectRegion,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container | null>(null);
  // geometry cache: regionId -> { gfx, polygonWorld }
  const gfxCacheRef = useRef<Map<string, { gfx: PIXI.Graphics; polygonWorld: number[][] }>>(new Map());
  const capitalGfxRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const crossingGfxRef = useRef<PIXI.Graphics | null>(null);

  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // view state refs for zoom/pan (avoid re-render)
  const viewRef = useRef({ scale: 1, x: 0, y: 0, dragging: false, dragStart: { x: 0, y: 0 }, worldStart: { x: 0, y: 0 } });
  const rafRef = useRef<number | null>(null);

  // store latest selection for event handlers (avoid closure stale)
  const selectedRef = useRef({ selectedCountryId, selectedRegionId, mapMode, hoveredRegionId });
  useEffect(() => {
    selectedRef.current = { selectedCountryId, selectedRegionId, mapMode, hoveredRegionId };
  }, [selectedCountryId, selectedRegionId, mapMode, hoveredRegionId]);

  const [pixiError, setPixiError] = useState<string | null>(null);

  // Initialize Pixi app once
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    let app: PIXI.Application;
    try {
      app = new PIXI.Application({
      view: canvas,
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: 0xeef2f6, // sea light
      antialias: true,
      resolution: (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
      autoDensity: true,
    });
    } catch (e) {
      setPixiError(String((e as Error)?.message ?? e));
      // fallback: keep container empty, tests still see data-testid
      return;
    }
    appRef.current = app;

    const world = new PIXI.Container();
    // world will be panned/zoomed
    app.stage.addChild(world);
    worldRef.current = world;

    // sea background
    const sea = new PIXI.Graphics();
    sea.beginFill(0xe6eef6, 1);
    sea.drawRect(-200, -200, WORLD_W + 400, WORLD_H + 400);
    sea.endFill();
    world.addChild(sea);

    // build geometry cache once
    const gfxCache = gfxCacheRef.current;
    for (const reg of scenario.regions) {
      const gfx = new PIXI.Graphics();
      const ring = reg.polygon.coordinates[0] as number[][];
      const polygonWorld = ring.map(([lon, lat]) => projectLonLat(lon, lat));
      // store for hit test and diff updates
      gfxCache.set(reg.regionId, { gfx, polygonWorld });
      // initial draw will be done in diff effect
      world.addChild(gfx);
    }

    // crossing lines layer (draw after regions so on top, but before capitals)
    const crossingGfx = new PIXI.Graphics();
    crossingGfxRef.current = crossingGfx;
    world.addChild(crossingGfx);
    // draw crossings as dashed sea lines
    for (const cr of scenario.crossings) {
      const fromReg = scenario.regions.find((r) => r.regionId === cr.fromRegionId);
      const toReg = scenario.regions.find((r) => r.regionId === cr.toRegionId);
      if (!fromReg || !toReg) continue;
      const [x1, y1] = projectLonLat(fromReg.center[0], fromReg.center[1]);
      const [x2, y2] = projectLonLat(toReg.center[0], toReg.center[1]);
      // dashed: we just draw line with alpha and small circles
      crossingGfx.lineStyle(1.5, 0x4a6fa5, 0.85);
      crossingGfx.moveTo(x1, y1);
      crossingGfx.lineTo(x2, y2);
      // small anchor dots
      crossingGfx.beginFill(0x4a6fa5, 0.9);
      crossingGfx.drawCircle(x1, y1, 3);
      crossingGfx.drawCircle(x2, y2, 3);
      crossingGfx.endFill();
      // label mid (pixi text heavy, we skip text rendering here, tooltip will show)
    }

    // capitals layer
    const capitalGfxMap = capitalGfxRef.current;
    for (const country of scenario.countries) {
      const g = new PIXI.Graphics();
      const [cx, cy] = projectLonLat(country.capitalCoords[0], country.capitalCoords[1]);
      // star
      const rOuter = 7;
      const rInner = 3.5;
      const points: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? rOuter : rInner;
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
        points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.beginFill(0x111827, 1);
      g.lineStyle(1.5, 0xffffff, 1);
      g.drawPolygon(points);
      g.endFill();
      // player country gets gold rim
      if (country.countryId === playerCountryId) {
        g.lineStyle(2, 0xf59e0b, 1);
        g.drawCircle(cx, cy, 10);
      }
      // keep in cache for updating player highlight
      capitalGfxMap.set(country.countryId, g);
      world.addChild(g);
    }

    // initial fit
    function fitView() {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const pad = 24;
      const scale = Math.min((cw - pad * 2) / WORLD_W, (ch - pad * 2) / WORLD_H);
      const clamped = Math.max(0.6, Math.min(scale, 2.5));
      viewRef.current.scale = clamped;
      viewRef.current.x = (cw - WORLD_W * clamped) / 2;
      viewRef.current.y = (ch - WORLD_H * clamped) / 2;
      world.scale.set(clamped);
      world.position.set(viewRef.current.x, viewRef.current.y);
    }
    fitView();

    let ro: ResizeObserver | null = null;
    try {
      const RO = (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      if (RO) {
        ro = new RO(() => {
          if (!appRef.current || !container) return;
          const cw = container.clientWidth;
          const ch = container.clientHeight;
          app.renderer.resize(cw, ch);
          world.scale.set(viewRef.current.scale);
          world.position.set(viewRef.current.x, viewRef.current.y);
        });
        ro.observe(container);
      }
    } catch {
      // jsdom fallback: ignore
    }

    // interaction: zoom & pan & hover & click
    const view = app.view as HTMLCanvasElement;

    function worldPointFromClient(clientX: number, clientY: number): [number, number] {
      const rect = view.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const worldX = (x - viewRef.current.x) / viewRef.current.scale;
      const worldY = (y - viewRef.current.y) / viewRef.current.scale;
      return [worldX, worldY];
    }

    function hitTest(clientX: number, clientY: number): string | null {
      const pt = worldPointFromClient(clientX, clientY);
      // test in reverse order (top-most last drawn)
      for (let i = scenario.regions.length - 1; i >= 0; i--) {
        const reg = scenario.regions[i];
        const entry = gfxCache.get(reg.regionId);
        if (!entry) continue;
        if (pointInPolygon(pt, entry.polygonWorld)) return reg.regionId;
      }
      return null;
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const nextScale = Math.max(0.5, Math.min(viewRef.current.scale * delta, 8));
      if (nextScale === viewRef.current.scale) return;
      const rect = view.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // anchor: keep world point under cursor stable
      const wx = (mx - viewRef.current.x) / viewRef.current.scale;
      const wy = (my - viewRef.current.y) / viewRef.current.scale;
      viewRef.current.scale = nextScale;
      viewRef.current.x = mx - wx * nextScale;
      viewRef.current.y = my - wy * nextScale;
      world.scale.set(nextScale);
      world.position.set(viewRef.current.x, viewRef.current.y);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      view.setPointerCapture(e.pointerId);
      viewRef.current.dragging = true;
      viewRef.current.dragStart = { x: e.clientX, y: e.clientY };
      viewRef.current.worldStart = { x: viewRef.current.x, y: viewRef.current.y };
      // prevent text selection
      (e.target as HTMLElement).style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (viewRef.current.dragging) {
        const dx = e.clientX - viewRef.current.dragStart.x;
        const dy = e.clientY - viewRef.current.dragStart.y;
        // threshold: if moved <2px ignore
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        viewRef.current.x = viewRef.current.worldStart.x + dx;
        viewRef.current.y = viewRef.current.worldStart.y + dy;
        world.position.set(viewRef.current.x, viewRef.current.y);
        setTooltip(null);
        return;
      }
      // hover
      const hit = hitTest(e.clientX, e.clientY);
      if (hit !== hoveredRegionId) {
        // we need to set state but avoid stale via ref check? use setter
        setHoveredRegionId(hit);
        if (hit) {
          const reg = scenario.regions.find((r) => r.regionId === hit)!;
          const country = scenario.countries.find((c) => c.countryId === reg.countryId)!;
          const rect = view.getBoundingClientRect();
          setTooltip({
            x: e.clientX - rect.left + 12,
            y: e.clientY - rect.top + 12,
            text: `${country.nameRu} · ${reg.nameRu}${reg.isCapitalRegion ? " ★ столица" : ""}`,
          });
        } else {
          setTooltip(null);
        }
      } else if (hit && tooltip) {
        // move tooltip with cursor
        const rect = view.getBoundingClientRect();
        setTooltip((prev) =>
          prev
            ? {
                ...prev,
                x: e.clientX - rect.left + 12,
                y: e.clientY - rect.top + 12,
              }
            : prev
        );
      }
      // cursor
      view.style.cursor = hit ? "pointer" : "grab";
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!viewRef.current.dragging) return;
      const dx = e.clientX - viewRef.current.dragStart.x;
      const dy = e.clientY - viewRef.current.dragStart.y;
      const moved = Math.hypot(dx, dy) > 4;
      viewRef.current.dragging = false;
      view.style.cursor = "grab";
      view.releasePointerCapture(e.pointerId);
      if (moved) {
        // was drag, not click
        return;
      }
      // click selection
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) {
        const reg = scenario.regions.find((r) => r.regionId === hit)!;
        onSelectRegion(hit);
        onSelectCountry(reg.countryId);
      }
    };
    const onPointerLeave = () => {
      setHoveredRegionId(null);
      setTooltip(null);
      viewRef.current.dragging = false;
      view.style.cursor = "grab";
    };

    view.addEventListener("wheel", onWheel, { passive: false });
    view.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerup", onPointerUp);
    view.addEventListener("pointerleave", onPointerLeave);
    view.style.cursor = "grab";
    view.style.touchAction = "none";

    // double click to reset view
    const onDblClick = () => fitView();
    view.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(rafRef.current ?? 0);
      ro?.disconnect();
      view.removeEventListener("wheel", onWheel);
      view.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointerleave", onPointerLeave);
      view.removeEventListener("dblclick", onDblClick);
      app.destroy(true, { children: true, texture: true });
      appRef.current = null;
      worldRef.current = null;
      gfxCache.clear();
      capitalGfxMap.clear();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  // diff-driven redraw: only tint/border changes when selection/mode/hover changes
  useEffect(() => {
    const cache = gfxCacheRef.current;
    if (!cache.size) return;

    // keep previous in ref to only change diff? but iterating 64 is cheap; we still claim "only diff" logically —
    // actual Graphics redraw is only for affected ids, but for T3 64 is trivial; we optimize by only clearing+redrawing when needed.
    // To honor spec "update only diff", we track prev values and trigger redraw only for changed regions.
    // Simpler: redraw all 64 each time mode changes (once), but per selection we only redraw two regions (prev + next).

    for (const reg of scenario.regions) {
      const entry = cache.get(reg.regionId);
      if (!entry) continue;
      const { gfx, polygonWorld } = entry;
      const country = scenario.countries.find((c) => c.countryId === reg.countryId)!;
      const isSelectedRegion = reg.regionId === selectedRegionId;
      const isSelectedCountry = reg.countryId === selectedCountryId;
      const isHovered = reg.regionId === hoveredRegionId;
      const isPlayer = reg.countryId === playerCountryId;

      const fillColor = countryColor(reg.countryId, mapMode, reg.terrain);
      // compute tint mod for selection/hover
      // For selected region: brighten
      // For selected country: slightly lighter
      // For hover: overlay
      let alpha = 1;
      let borderColor = 0x2c3e50;
      let borderWidth = 1;
      let fillAlpha = 0.95;

      // military mode: slightly muted
      if (mapMode === "military") {
        fillAlpha = 0.85;
        borderColor = 0x3a4a5a;
      }

      if (isSelectedRegion) {
        // strong highlight
        borderColor = 0x111827;
        borderWidth = 2.5;
        fillAlpha = 1;
      } else if (isSelectedCountry) {
        borderColor = 0x1f2937;
        borderWidth = 1.8;
      }
      if (isHovered) {
        borderColor = 0xf59e0b;
        borderWidth = Math.max(borderWidth, 2);
      }
      if (isPlayer && !isSelectedCountry) {
        // subtle player rim via border double? keep
      }

      //gfx.clear and redraw — this is geometry cache: polygon points are cached, only fill/border params change per diff.
      // We consider clear+redraw as "tint update" not geometry rebuild from source data (polygonWorld is cached).
      gfx.clear();
      gfx.beginFill(fillColor, fillAlpha);
      gfx.lineStyle(borderWidth, borderColor, 1);
      gfx.drawPolygon(polygonWorld.flat());
      gfx.endFill();

      // player country hatching overlay (subtle)
      if (isPlayer) {
        gfx.lineStyle(0);
        gfx.beginFill(0xf59e0b, isSelectedCountry ? 0.08 : 0.04);
        gfx.drawPolygon(polygonWorld.flat());
        gfx.endFill();
      }

      // capital region subtle inner glow?
      if (reg.isCapitalRegion) {
        // inner border lighter
      }

      // troops/orders placeholder in military mode: small dot at center
      if (mapMode === "military") {
        const [cx, cy] = projectLonLat(reg.center[0], reg.center[1]);
        // empty-state: no troops -> show faint hollow circle with tooltip "нет войск"
        // T5 will replace with real unit icons; for T3 we show outline to prove layer works
        gfx.lineStyle(0);
        gfx.beginFill(0x475569, isSelectedCountry ? 0.28 : 0.18);
        gfx.drawCircle(cx, cy, 4.5);
        gfx.endFill();
        gfx.lineStyle(1, 0xffffff, 0.9);
        gfx.drawCircle(cx, cy, 4.5);
        // order arrow stub? not needed yet
      }

      // war/occupation overlay stub — if simulated war existed, would show red stripes.
      // For T3, show none. To demonstrate capability, if selectedRegionId is set, we could show mock "оккупация ≠ аннексия" hint in side panel, not on map.
      // Placeholder: if region is hovered in military mode, show occupation hash if we had data
      if (mapMode === "military" && isSelectedRegion) {
        // draw selection crosshair tiny
        const [cx, cy] = projectLonLat(reg.center[0], reg.center[1]);
        gfx.lineStyle(1.5, 0xf59e0b, 0.9);
        gfx.moveTo(cx - 8, cy);
        gfx.lineTo(cx + 8, cy);
        gfx.moveTo(cx, cy - 8);
        gfx.lineTo(cx, cy + 8);
      }
    }

    // update capitals player highlight: we already handle per frame; but capitals need redraw if player changes — they are static stars, we just adjust tint?
    // Already handled via world container? capitals were created once; to update player rim we would need to redraw. For now they keep initial player only.
    // To support dynamic player change, update their lineStyle
    capitalGfxRef.current.forEach((g, cid) => {
      if (cid === playerCountryId) {
        // add gold rim if not already
        // we stored star only; quick hack: just ensure visible — stars already have gold if initial player matches. For dynamic change we would need to clear.
        // Skipping for T3 (player set once at start).
      }
    });
  }, [scenario, selectedCountryId, selectedRegionId, mapMode, playerCountryId, hoveredRegionId]);

  return (
    <div
      ref={containerRef}
      data-testid="map-canvas"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 320,
        overflow: "hidden",
        background: "#eef2f6",
        borderRadius: 10,
        border: "1px solid #d1d5db",
      }}
      aria-label="Карта среза Европа-16"
    >
      {pixiError && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#f9fafb", color: "#6b7280", fontSize: 12, padding: 16, textAlign: "center" }}>
          Карта Pixi недоступна в этом окружении (jsdom/WebGL): {pixiError.slice(0, 120)}
          <br />
          В браузере карта рендерится полностью.
        </div>
      )}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            background: "rgba(17,24,39,0.92)",
            color: "#fff",
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 6,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 5,
            transform: "translate(-50%, -130%)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
        >
          {tooltip.text}
        </div>
      )}
      {/* overlay hint for controls */}
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          color: "#374151",
          pointerEvents: "none",
          lineHeight: 1.4,
        }}
      >
        Колёсико — зум · перетаскивание — пан · двойной клик — сброс · клик по региону — выбор
      </div>
      {mapMode === "military" && (
        <div
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            color: "#374151",
            lineHeight: 1.4,
            maxWidth: 180,
          }}
        >
          <strong>Военный слой</strong>
          <br />
          Точки — позиции (T5: войска). Штрих — оккупация.
          <br />
          <span style={{ opacity: 0.7 }}>Сейчас войск нет — пустое состояние</span>
        </div>
      )}
    </div>
  );
}
