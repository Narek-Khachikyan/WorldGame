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

export interface MapRegionState {
  regionId: string;
  ownerId: string;
  controllerId: string;
}

export interface MapUnit {
  unitId: string;
  countryId: string;
  regionId: string;
  personnel: number;
  readiness: number;
}

interface Props {
  scenario: Scenario;
  selectedCountryId: string | null;
  selectedRegionId: string | null;
  mapMode: MapMode;
  playerCountryId?: string | null;
  regionStates?: MapRegionState[];
  units?: MapUnit[];
  onSelectCountry: (id: string) => void;
  onSelectRegion: (id: string) => void;
}

export default function MapCanvas({
  scenario,
  selectedCountryId,
  selectedRegionId,
  mapMode,
  playerCountryId,
  regionStates,
  units,
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
  const unitsGfxRef = useRef<PIXI.Graphics | null>(null);
  const labelsRef = useRef<Map<string, PIXI.Text>>(new Map());
  // diff keys per region to avoid full redraws
  const prevKeyRef = useRef<Map<string, string>>(new Map());
  const prevUnitsKeyRef = useRef<string>("");
  const prevPlayerRef = useRef<string | null>(null);

  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // view state refs for zoom/pan (avoid re-render)
  const viewRef = useRef({ scale: 1, x: 0, y: 0, dragging: false, dragStart: { x: 0, y: 0 }, worldStart: { x: 0, y: 0 } });

  // live data lookups (owner/controller from sim, not scenario initial owner)
  const ownerByRegion = new Map<string, string>();
  const controllerByRegion = new Map<string, string>();
  for (const rs of regionStates ?? []) {
    ownerByRegion.set(rs.regionId, rs.ownerId);
    controllerByRegion.set(rs.regionId, rs.controllerId);
  }
  const unitsByRegion = new Map<string, MapUnit[]>();
  for (const u of units ?? []) {
    const arr = unitsByRegion.get(u.regionId) ?? [];
    arr.push(u);
    unitsByRegion.set(u.regionId, arr);
  }

  // latest values for event handlers (avoid stale closures)
  const liveRef = useRef({ selectedCountryId, selectedRegionId, mapMode, hoveredRegionId, ownerByRegion, controllerByRegion, unitsByRegion, scenario, onSelectCountry, onSelectRegion });
  liveRef.current = { selectedCountryId, selectedRegionId, mapMode, hoveredRegionId, ownerByRegion, controllerByRegion, unitsByRegion, scenario, onSelectCountry, onSelectRegion };

  const [pixiError, setPixiError] = useState<string | null>(null);

  // Initialize Pixi app once (never recreated on tick/selection/panel switches)
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
      backgroundColor: 0x0d1219, // dark sea for grand-strategy theme
      antialias: true,
      resolution: (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
      autoDensity: true,
    });
    } catch (e) {
      setPixiError(String((e as Error)?.message ?? e));
      return;
    }
    appRef.current = app;

    const world = new PIXI.Container();
    app.stage.addChild(world);
    worldRef.current = world;

    // sea background
    const sea = new PIXI.Graphics();
    sea.beginFill(0x131a26, 1);
    sea.drawRect(-200, -200, WORLD_W + 400, WORLD_H + 400);
    sea.endFill();
    world.addChild(sea);

    // build geometry cache once (static geometry separated from dynamic fills)
    const gfxCache = gfxCacheRef.current;
    for (const reg of scenario.regions) {
      const gfx = new PIXI.Graphics();
      const ring = reg.polygon.coordinates[0] as number[][];
      const polygonWorld = ring.map(([lon, lat]) => projectLonLat(lon, lat));
      gfxCache.set(reg.regionId, { gfx, polygonWorld });
      world.addChild(gfx);
    }

    // crossing lines layer
    const crossingGfx = new PIXI.Graphics();
    crossingGfxRef.current = crossingGfx;
    world.addChild(crossingGfx);
    for (const cr of scenario.crossings) {
      const fromReg = scenario.regions.find((r) => r.regionId === cr.fromRegionId);
      const toReg = scenario.regions.find((r) => r.regionId === cr.toRegionId);
      if (!fromReg || !toReg) continue;
      const [x1, y1] = projectLonLat(fromReg.center[0], fromReg.center[1]);
      const [x2, y2] = projectLonLat(toReg.center[0], toReg.center[1]);
      crossingGfx.lineStyle(1.5, 0x4a6fa5, 0.85);
      crossingGfx.moveTo(x1, y1);
      crossingGfx.lineTo(x2, y2);
      crossingGfx.beginFill(0x4a6fa5, 0.9);
      crossingGfx.drawCircle(x1, y1, 3);
      crossingGfx.drawCircle(x2, y2, 3);
      crossingGfx.endFill();
    }

    // capitals layer (redrawn dynamically on player change)
    const capitalGfxMap = capitalGfxRef.current;
    for (const country of scenario.countries) {
      const g = new PIXI.Graphics();
      capitalGfxMap.set(country.countryId, g);
      world.addChild(g);
    }

    // units layer (dynamic, above regions, below tooltip DOM)
    const unitsGfx = new PIXI.Graphics();
    unitsGfxRef.current = unitsGfx;
    world.addChild(unitsGfx);

    // country labels (code at capital; counter-scaled so they stay readable on zoom)
    const labelMap = labelsRef.current;
    for (const country of scenario.countries) {
      const [cx, cy] = projectLonLat(country.capitalCoords[0], country.capitalCoords[1]);
      let text: PIXI.Text;
      try {
        text = new PIXI.Text(country.countryId, {
          fontFamily: "system-ui, sans-serif",
          fontSize: 11,
          fontWeight: "700",
          fill: 0xffffff,
          stroke: 0x0d1219,
          strokeThickness: 3,
        });
      } catch {
        continue;
      }
      text.anchor.set(0.5, 0.5);
      text.position.set(cx, cy + 16);
      labelMap.set(country.countryId, text);
      world.addChild(text);
    }
    function updateLabelScale() {
      const s = viewRef.current.scale;
      for (const text of labelMap.values()) {
        const k = Math.max(0.55, Math.min(1.4, 1 / s));
        text.scale.set(k);
        text.visible = s < 5; // на сильном зуме подписи стран не превращаются в кашу
      }
    }

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
      updateLabelScale();
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
      const regs = liveRef.current.scenario.regions;
      for (let i = regs.length - 1; i >= 0; i--) {
        const reg = regs[i];
        const entry = gfxCache.get(reg.regionId);
        if (!entry) continue;
        if (pointInPolygon(pt, entry.polygonWorld)) return reg.regionId;
      }
      return null;
    }

    function tooltipText(regionId: string): string {
      const live = liveRef.current;
      const reg = live.scenario.regions.find((r) => r.regionId === regionId);
      if (!reg) return regionId;
      const owner = live.ownerByRegion.get(regionId) ?? reg.countryId;
      const controller = live.controllerByRegion.get(regionId) ?? owner;
      const ownerName = live.scenario.countries.find((c) => c.countryId === owner)?.nameRu ?? owner;
      const unitsHere = live.unitsByRegion.get(regionId) ?? [];
      const occ = owner !== controller ? " · оккупировано" : "";
      const troops = unitsHere.length ? ` · войск: ${unitsHere.length} (${unitsHere.reduce((s, u) => s + u.personnel, 0)} чел.)` : "";
      return `${ownerName} · ${reg.nameRu}${reg.isCapitalRegion ? " ★" : ""}${occ}${troops}`;
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
      updateLabelScale();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try { view.setPointerCapture(e.pointerId); } catch { /* noop */ }
      viewRef.current.dragging = true;
      viewRef.current.dragStart = { x: e.clientX, y: e.clientY };
      viewRef.current.worldStart = { x: viewRef.current.x, y: viewRef.current.y };
      view.style.cursor = "grabbing";
    };
    const endDrag = (e: PointerEvent) => {
      if (!viewRef.current.dragging) return;
      const dx = e.clientX - viewRef.current.dragStart.x;
      const dy = e.clientY - viewRef.current.dragStart.y;
      const moved = Math.hypot(dx, dy) > 4;
      viewRef.current.dragging = false;
      view.style.cursor = "grab";
      try { view.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      if (moved) return; // was drag, not click
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) {
        const live = liveRef.current;
        live.onSelectRegion(hit);
        const owner = live.ownerByRegion.get(hit) ?? live.scenario.regions.find((r) => r.regionId === hit)?.countryId;
        if (owner) live.onSelectCountry(owner);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (viewRef.current.dragging) {
        const dx = e.clientX - viewRef.current.dragStart.x;
        const dy = e.clientY - viewRef.current.dragStart.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        viewRef.current.x = viewRef.current.worldStart.x + dx;
        viewRef.current.y = viewRef.current.worldStart.y + dy;
        world.position.set(viewRef.current.x, viewRef.current.y);
        setTooltip(null);
        return;
      }
      const hit = hitTest(e.clientX, e.clientY);
      const prevHit = liveRef.current.hoveredRegionId;
      if (hit !== prevHit) {
        setHoveredRegionId(hit);
        if (hit) {
          const rect = view.getBoundingClientRect();
          // clamp tooltip inside viewport
          const rawX = e.clientX - rect.left + 12;
          const rawY = e.clientY - rect.top + 12;
          const x = Math.max(70, Math.min(rawX, rect.width - 70));
          const y = Math.max(30, Math.min(rawY, rect.height - 10));
          setTooltip({ x, y, text: tooltipText(hit) });
        } else {
          setTooltip(null);
        }
      } else if (hit) {
        const rect = view.getBoundingClientRect();
        const rawX = e.clientX - rect.left + 12;
        const rawY = e.clientY - rect.top + 12;
        const x = Math.max(70, Math.min(rawX, rect.width - 70));
        const y = Math.max(30, Math.min(rawY, rect.height - 10));
        setTooltip({ x, y, text: tooltipText(hit) });
      }
      view.style.cursor = hit ? "pointer" : "grab";
    };
    const onPointerLeave = () => {
      setHoveredRegionId(null);
      setTooltip(null);
      viewRef.current.dragging = false;
      view.style.cursor = "grab";
    };
    const onPointerCancel = () => {
      viewRef.current.dragging = false;
      setTooltip(null);
      view.style.cursor = "grab";
    };

    view.addEventListener("wheel", onWheel, { passive: false });
    view.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerup", endDrag);
    view.addEventListener("pointerleave", onPointerLeave);
    view.addEventListener("pointercancel", onPointerCancel);
    view.style.cursor = "grab";
    view.style.touchAction = "none";

    const onDblClick = () => fitView();
    view.addEventListener("dblclick", onDblClick);

    return () => {
      ro?.disconnect();
      view.removeEventListener("wheel", onWheel);
      view.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", endDrag);
      view.removeEventListener("pointerleave", onPointerLeave);
      view.removeEventListener("pointercancel", onPointerCancel);
      view.removeEventListener("dblclick", onDblClick);
      app.destroy(true, { children: true, texture: true });
      appRef.current = null;
      worldRef.current = null;
      gfxCache.clear();
      capitalGfxMap.clear();
      unitsGfxRef.current = null;
      // NB: app.destroy(true, {children:true}) above already destroys label Text objects —
      // do NOT destroy them individually (double-destroy throws in StrictMode dev).
      labelsRef.current.clear();
      prevKeyRef.current.clear();
      prevUnitsKeyRef.current = "";
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  // diff-driven redraw: regions only when their key changes; units layer only when units change
  useEffect(() => {
    const cache = gfxCacheRef.current;
    if (!cache.size) return;

    for (const reg of scenario.regions) {
      const entry = cache.get(reg.regionId);
      if (!entry) continue;
      const owner = ownerByRegion.get(reg.regionId) ?? reg.countryId;
      const controller = controllerByRegion.get(reg.regionId) ?? owner;
      const occupied = owner !== controller;
      const isSelectedRegion = reg.regionId === selectedRegionId;
      const isSelectedCountry = owner === selectedCountryId;
      const isHovered = reg.regionId === hoveredRegionId;
      const isPlayer = owner === playerCountryId;
      const nUnits = unitsByRegion.get(reg.regionId)?.length ?? 0;

      const key = [owner, controller, mapMode, isSelectedRegion, isSelectedCountry, isHovered, isPlayer, nUnits].join("|");
      if (prevKeyRef.current.get(reg.regionId) === key) continue;
      prevKeyRef.current.set(reg.regionId, key);

      const { gfx, polygonWorld } = entry;
      const fillColor = countryColor(owner, mapMode, reg.terrain);
      let borderColor = 0x8a94a6;
      let borderWidth = 1;
      let fillAlpha = 0.92;

      if (mapMode === "military") {
        fillAlpha = 0.85;
        borderColor = 0x5a6577;
      }
      if (occupied) {
        borderColor = 0xe0685c;
        borderWidth = 2;
      }
      if (isSelectedRegion) {
        borderColor = 0xe8c87a;
        borderWidth = 2.5;
        fillAlpha = 1;
      } else if (isSelectedCountry) {
        borderColor = 0xd8dce4;
        borderWidth = 1.8;
      }
      if (isHovered) {
        borderColor = 0xe8c87a;
        borderWidth = Math.max(borderWidth, 2);
      }

      gfx.clear();
      gfx.beginFill(fillColor, fillAlpha);
      gfx.lineStyle(borderWidth, borderColor, 1);
      gfx.drawPolygon(polygonWorld.flat());
      gfx.endFill();

      // player tint
      if (isPlayer) {
        gfx.lineStyle(0);
        gfx.beginFill(0xe8c87a, isSelectedCountry ? 0.1 : 0.05);
        gfx.drawPolygon(polygonWorld.flat());
        gfx.endFill();
      }

      // occupation hatching: diagonal lines in controller color family (red tint)
      if (occupied) {
        const xs = polygonWorld.map((p) => p[0]);
        const ys = polygonWorld.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        gfx.lineStyle(1, 0xe0685c, 0.55);
        for (let hx = minX - (maxY - minY); hx < maxX; hx += 9) {
          gfx.moveTo(hx, maxY);
          gfx.lineTo(hx + (maxY - minY), minY);
        }
      }

      if (mapMode === "military" && isSelectedRegion) {
        const [cx, cy] = projectLonLat(reg.center[0], reg.center[1]);
        gfx.lineStyle(1.5, 0xe8c87a, 0.9);
        gfx.moveTo(cx - 8, cy);
        gfx.lineTo(cx + 8, cy);
        gfx.moveTo(cx, cy - 8);
        gfx.lineTo(cx, cy + 8);
      }
    }

    // capitals: redraw only when player changes or first run
    if (prevPlayerRef.current !== (playerCountryId ?? null) || prevPlayerRef.current === null) {
      prevPlayerRef.current = playerCountryId ?? null;
      for (const country of scenario.countries) {
        const g = capitalGfxRef.current.get(country.countryId);
        if (!g) continue;
        g.clear();
        const [cx, cy] = projectLonLat(country.capitalCoords[0], country.capitalCoords[1]);
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
        if (country.countryId === playerCountryId) {
          g.lineStyle(2, 0xe8c87a, 1);
          g.drawCircle(cx, cy, 10);
        }
      }
    }

    // units layer: real armies, not placeholders
    const unitsGfx = unitsGfxRef.current;
    if (unitsGfx) {
      const unitsKey = JSON.stringify((units ?? []).map((u) => [u.unitId, u.regionId, u.countryId, u.personnel, u.readiness].join(":")).sort());
      if (prevUnitsKeyRef.current !== unitsKey) {
        prevUnitsKeyRef.current = unitsKey;
        unitsGfx.clear();
        const byRegion = new Map<string, MapUnit[]>();
        for (const u of units ?? []) {
          const arr = byRegion.get(u.regionId) ?? [];
          arr.push(u);
          byRegion.set(u.regionId, arr);
        }
        for (const [regionId, arr] of byRegion) {
          const reg = scenario.regions.find((r) => r.regionId === regionId);
          if (!reg) continue;
          const [cx, cy] = projectLonLat(reg.center[0], reg.center[1]);
          arr.forEach((u, idx) => {
            const off = (idx - (arr.length - 1) / 2) * 11;
            const r = Math.max(4, Math.min(9, 3 + Math.sqrt(u.personnel) / 18));
            const isMine = u.countryId === playerCountryId;
            const fill = isMine ? 0xe8c87a : 0x3a4356;
            unitsGfx.lineStyle(1.5, 0xffffff, 0.95);
            unitsGfx.beginFill(fill, u.readiness < 1 ? 0.75 : 1);
            unitsGfx.drawCircle(cx + off, cy - 10, r);
            unitsGfx.endFill();
            if (u.readiness < 1) {
              // readiness arc stub: inner dot
              unitsGfx.beginFill(0xffffff, 0.5);
              unitsGfx.drawCircle(cx + off, cy - 10, 1.5);
              unitsGfx.endFill();
            }
          });
        }
      }
    }
  });

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
        background: "#0d1219",
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
            background: "rgba(17,24,39,0.94)",
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
        className="gs-map-hint"
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          background: "rgba(22,28,40,0.9)",
          border: "1px solid #2e3849",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          color: "#a8b0c0",
          pointerEvents: "none",
          lineHeight: 1.4,
        }}
      >
        Колёсико — зум · перетаскивание — пан · двойной клик — сброс · клик по региону — выбор
      </div>
    </div>
  );
}
