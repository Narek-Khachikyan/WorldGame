import { useMemo, useState } from "react";
import type { Country } from "../../sim/scenario.js";
import { getProfileForCountry } from "../data/countryProfiles.js";
import type { Scenario } from "../../sim/scenario.js";
import { useGameStore } from "../store.js";
import ru from "../locales/ru.json";

interface Props {
  scenario: Scenario;
  onPick: (countryId: string) => void;
  onViewOnMap?: (countryId: string) => void;
}

const COUNTRY_COLORS: Record<string, string> = {
  GB: "#8FA8C8",
  FR: "#A8C4A0",
  ES: "#D4C08A",
  IT: "#A8C8B8",
  DE: "#C4B8A0",
  PL: "#C8A8A8",
  SE: "#9BB8D0",
  RO: "#C0B0C8",
  GR: "#B8C0A8",
  UA: "#E0C8A0",
  TR: "#C8B0A0",
  BY: "#A8B0C0",
  CZ: "#B8A8B8",
  AT: "#C8C0B0",
  HU: "#A8B8A8",
  RS: "#B0A8A8",
};

export default function CountrySelection({ scenario, onPick, onViewOnMap }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const t = ru as Record<string, string>;

  const selectedCountry = useMemo(
    () => (selected ? scenario.countries.find((c) => c.countryId === selected) ?? null : null),
    [selected, scenario.countries]
  );
  const profile = useMemo(() => (selectedCountry ? getProfileForCountry(selectedCountry) : null), [selectedCountry]);

  // sort countries for grid: west->east roughly by bbox minLon, then north->south?
  const sorted = useMemo(() => {
    return [...scenario.countries].sort((a, b) => a.bbox[0] - b.bbox[0]);
  }, [scenario.countries]);

  return (
    <div
      data-testid="country-selection"
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 12,
        background: "#ffffff",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", background: "linear-gradient(180deg,#f9fafb 0%, #ffffff 100%)" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t["selection.title"] ?? "Выберите страну — Европа-16"}</h2>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280", lineHeight: 1.4 }}>
          {t["selection.subtitle"] ??
            "Срез A: 16 стран, 64 региона. Каждая — своя позиция, сильные стороны и риски. Решение влияет на всю партию."}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 0.95fr", gap: 0, minHeight: 420 }}>
        {/* grid */}
        <div style={{ padding: 12, borderRight: "1px solid #e5e7eb", background: "#fcfcf9" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}
          >
            {sorted.map((c) => {
              const isSel = c.countryId === selected;
              const col = COUNTRY_COLORS[c.countryId] ?? "#ccc";
              return (
                <button
                  key={c.countryId}
                  onClick={() => {
                    setSelected(c.countryId);
                    useGameStore.getState().selectCountry(c.countryId);
                  }}
                  data-testid={`country-card-${c.countryId}`}
                  style={{
                    textAlign: "left",
                    border: isSel ? "2px solid #111827" : "1px solid #e5e7eb",
                    background: isSel ? "#111827" : "#ffffff",
                    color: isSel ? "#fff" : "#111827",
                    borderRadius: 10,
                    padding: 10,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    minHeight: 96,
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: isSel ? "0 4px 12px rgba(0,0,0,0.18)" : "0 1px 2px rgba(0,0,0,0.04)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 6,
                      background: col,
                    }}
                  />
                  <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{c.nameRu}</div>
                  <div style={{ fontSize: 10, opacity: isSel ? 0.75 : 0.65, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {c.capital} · {c.landlocked ? "landlocked" : c.island ? "остров" : "берег"}
                  </div>
                  <div style={{ fontSize: 11, opacity: isSel ? 0.9 : 0.7, lineHeight: 1.25, marginTop: "auto" }}>
                    {getProfileForCountry(c).position.slice(0, 46)}…
                  </div>
                  {isSel && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 6,
                        right: 8,
                        fontSize: 10,
                        background: "#fff",
                        color: "#111827",
                        padding: "2px 6px",
                        borderRadius: 999,
                        fontWeight: 700,
                      }}
                    >
                      выбрано
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", padding: "4px 8px", borderRadius: 999 }}>
              Всего 16 · 64 региона · старт 01.01.2026
            </span>
            <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", padding: "4px 8px", borderRadius: 999 }}>
              Дата выборов своя у каждой страны (месяц/день)
            </span>
          </div>
        </div>

        {/* detail */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "#fff" }}>
          {!selectedCountry || !profile ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#6b7280", textAlign: "center", padding: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: "#f3f4f6", border: "1px dashed #d1d5db", display: "grid", placeItems: "center", fontSize: 22 }}>🗺️</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Выберите страну слева</div>
              <div style={{ fontSize: 12, lineHeight: 1.4 }}>Увидите положение на карте, сильные стороны и риски. Все выборы работают — карта интерактивна.</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>Подсказка: кликните карту, чтобы выбрать напрямую, или карточку здесь.</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: COUNTRY_COLORS[selectedCountry.countryId] ?? "#ccc",
                    border: "1px solid rgba(0,0,0,0.08)",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 800,
                    color: "#111827",
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {selectedCountry.countryId}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{selectedCountry.nameRu}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {selectedCountry.nameEn} · столица {selectedCountry.capital} · {selectedCountry.island ? "остров" : selectedCountry.landlocked ? "без выхода к морю" : "приморская"}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                    Выборы: {String(selectedCountry.electionDay).padStart(2, "0")}.{String(selectedCountry.electionMonth).padStart(2, "0")} каждые 5 лет · следущие:{" "}
                    {(() => {
                      const m = String(selectedCountry.electionMonth).padStart(2, "0");
                      const d = String(selectedCountry.electionDay).padStart(2, "0");
                      // compute 2026 or 2031 etc — simple
                      return `2026-${m}-${d}`;
                    })()}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                <strong>Положение:</strong> {profile.position}
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "#065f46", marginBottom: 6 }}>
                  Сильные стороны
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                  {profile.strengths.map((s) => (
                    <li key={s} style={{ fontSize: 12, lineHeight: 1.4 }}>
                      <span style={{ color: "#065f46" }}>●</span> {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "#991b1b", marginBottom: 6 }}>
                  Риски
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                  {profile.risks.map((s) => (
                    <li key={s} style={{ fontSize: 12, lineHeight: 1.4 }}>
                      <span style={{ color: "#991b1b" }}>●</span> {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  onClick={() => onPick(selectedCountry.countryId)}
                  data-testid="btn-start-game"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #111827",
                    background: "#111827",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Играть за {selectedCountry.nameRu} →
                </button>
                {onViewOnMap && (
                  <button
                    onClick={() => onViewOnMap(selectedCountry.countryId)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#374151",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Показать на карте
                  </button>
                )}
                <div style={{ fontSize: 11, color: "#6b7280", textAlign: "center", lineHeight: 1.3 }}>
                  Смена страны возможна и после старта — через карту или эту панель.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
