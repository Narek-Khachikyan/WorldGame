import { useMemo } from "react";
import { useGameStore } from "../store.js";
import { getProfileForCountry } from "../data/countryProfiles.js";
import LeaderAvatar from "../LeaderAvatar.js";

/**
 * Обзор — контекст выбранной страны/региона по живому состоянию симуляции.
 * Управление чужой экономикой/армией/политикой здесь недоступно:
 * разделы Экономика/Армия/Политика всегда работают со страной игрока.
 */
export default function SidePanel({ onGotoDiplomacy }: { onGotoDiplomacy: () => void }) {
  const scenario = useGameStore((s) => s.scenario);
  const selectedCountryId = useGameStore((s) => s.selectedCountryId);
  const selectedRegionId = useGameStore((s) => s.selectedRegionId);
  useGameStore((s) => s.lastDate);
  useGameStore((s) => s.stateRev);
  const hasStarted = useGameStore((s) => s.hasStarted);
  const playerCountryId = useGameStore((s) => s.playerCountryId);
  const isDevMode = useGameStore((s) => s.isDevMode);
  const sim = useGameStore((s) => s.sim);

  const selectedCountry = useMemo(
    () => (selectedCountryId ? scenario.countries.find((c) => c.countryId === selectedCountryId) ?? null : null),
    [scenario.countries, selectedCountryId]
  );
  const selectedRegion = useMemo(
    () => (selectedRegionId ? scenario.regions.find((r) => r.regionId === selectedRegionId) ?? null : null),
    [scenario.regions, selectedRegionId]
  );

  const leaders = useMemo(
    () => (selectedCountry ? scenario.leaders.find((l) => l.countryId === selectedCountry.countryId) ?? null : null),
    [scenario.leaders, selectedCountry]
  );

  const political = useMemo(() => {
    if (!selectedCountryId) return null;
    try { return sim.getPoliticalState(selectedCountryId); } catch { return null; }
  }, [sim, selectedCountryId]);

  // Живое владение/контроль региона (а не стартовый scenario.countryId).
  const liveRegion = useMemo(() => {
    if (!selectedRegionId) return null;
    try { return sim.getRegionState(selectedRegionId) ?? null; } catch { return null; }
  }, [sim, selectedRegionId]);

  const unitsHere = useMemo(() => {
    if (!selectedRegionId) return [];
    try { return sim.getUnitsInRegion(selectedRegionId); } catch { return []; }
  }, [sim, selectedRegionId]);

  const regionProjects = useMemo(() => {
    if (!selectedRegionId || !liveRegion) return [];
    try {
      const eco = sim.getEconomy(liveRegion.ownerId);
      if (!eco) return [];
      return [...eco.activeProjects.filter((p) => p.regionId === selectedRegionId).map((p) => ({ ...p, status: "active" as const })), ...eco.completedProjects.filter((p) => p.regionId === selectedRegionId).map((p) => ({ ...p, status: "done" as const }))];
    } catch { return []; }
  }, [sim, selectedRegionId, liveRegion]);

  const regimeRu: Record<string, string> = {
    liberalDemocracy: "Либеральная демократия",
    electoralDemocracy: "Электоральная демократия",
    authoritarian: "Авторитарный",
    oneParty: "Однопартийный",
  };

  const isForeign = !!selectedCountryId && !!playerCountryId && selectedCountryId !== playerCountryId;

  return (
    <div data-testid="side-panel" className="gs-side-body" style={{ padding: 0 }}>
      {!selectedCountry ? (
        <div className="gs-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Ничего не выбрано</div>
          <div className="gs-muted" style={{ marginTop: 4 }}>
            Кликните страну или регион на карте. Двойной клик — сброс камеры.
          </div>
        </div>
      ) : (
        <>
          <div className="gs-card">
            <div className="gs-row" style={{ alignItems: "flex-start" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#0f141d", border: "1px solid var(--gs-line)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12 }}>
                {selectedCountry.countryId}
              </div>
              <div style={{ flex: 1 }}>
                <div data-testid="selected-country-label" style={{ fontWeight: 800, fontSize: 14 }}>{selectedCountry.nameRu}</div>
                <div className="gs-faint">
                  {selectedCountry.capital} · {selectedCountry.island ? "остров" : selectedCountry.landlocked ? "без выхода к морю" : "приморская"} · 4 региона
                </div>
                <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {playerCountryId === selectedCountry.countryId && <span className="gs-tag">ваша страна</span>}
                  {isForeign && <span className="gs-tag dim">чужая территория</span>}
                  {hasStarted ? <span className="gs-tag dim">игра идёт</span> : <span className="gs-tag dim">до старта</span>}
                </div>
              </div>
            </div>
          </div>

          {(() => {
            const p = getProfileForCountry(selectedCountry);
            return (
              <>
                <div className="gs-card">
                  <strong>Положение:</strong> <span className="gs-muted">{p.position}</span>
                </div>
                <div className="gs-grid2">
                  <div className="gs-card">
                    <h3>Сильные стороны</h3>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 14, fontSize: 11, lineHeight: 1.4 }}>
                      {p.strengths.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                  <div className="gs-card">
                    <h3>Риски</h3>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 14, fontSize: 11, lineHeight: 1.4 }}>
                      {p.risks.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                </div>
              </>
            );
          })()}

          {(political ?? leaders) && (
            <div className="gs-card">
              <div className="gs-row">
                <LeaderAvatar name={political ? political.leaderId : leaders!.incumbent.name} title={political ? political.leaderTitle : leaders!.incumbent.title} size={34} portrait={null} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{political ? political.leaderId : leaders!.incumbent.name}</div>
                  <div className="gs-faint">{political ? `${political.leaderTitle} · ${regimeRu[political.regime] ?? political.regime}` : leaders!.incumbent.title}</div>
                  {political && <div className="gs-faint">Стабильность {political.stability.toFixed(1)} · поддержка {political.support.toFixed(1)}</div>}
                </div>
              </div>
              <div className="gs-faint" style={{ marginTop: 6 }}>
                Выборы {String(selectedCountry.electionDay).padStart(2, "0")}.{String(selectedCountry.electionMonth).padStart(2, "0")} каждые 5 лет · ближайшие: <strong>{political ? political.nextElectionDate : "—"}</strong>
              </div>
            </div>
          )}

          {isForeign && (
            <div className="gs-card" style={{ borderColor: "var(--gs-brass-dark)" }}>
              <h3>Чужая территория</h3>
              <div className="gs-muted">Управление экономикой, армией и политикой здесь недоступно — эти разделы всегда относятся к вашей стране ({playerCountryId}).</div>
              <div style={{ marginTop: 8 }}>
                <button className="gs-btn primary" onClick={onGotoDiplomacy} data-testid="btn-goto-diplomacy">
                  К дипломатии с {selectedCountry.countryId} →
                </button>
              </div>
            </div>
          )}

          {selectedRegion ? (
            <div className="gs-card">
              <h3>Регион</h3>
              <div data-testid="selected-region-label" style={{ fontWeight: 700 }}>{selectedRegion.nameRu} <span className="gs-faint">({selectedRegion.regionId})</span></div>
              <div className="gs-faint" style={{ marginTop: 2 }}>
                {selectedRegion.terrain === "mountains" ? "горы" : selectedRegion.terrain === "city" ? "город" : "равнина"}
                {selectedRegion.isCapitalRegion ? " · ★ столичный" : ""}
              </div>
              <div style={{ marginTop: 6 }}>
                <div className="gs-kv"><span className="k">Владелец</span><strong>{liveRegion ? (scenario.countries.find((c) => c.countryId === liveRegion.ownerId)?.nameRu ?? liveRegion.ownerId) : "—"}</strong></div>
                <div className="gs-kv"><span className="k">Контролёр</span><strong>{liveRegion ? (scenario.countries.find((c) => c.countryId === liveRegion.controllerId)?.nameRu ?? liveRegion.controllerId) : "—"}</strong></div>
                {liveRegion && liveRegion.ownerId !== liveRegion.controllerId && (
                  <div style={{ marginTop: 4 }}><span className="gs-tag danger">оккупировано: захват ≠ аннексия</span></div>
                )}
              </div>
              <div className="gs-faint" style={{ marginTop: 6 }}>Соседи: {(scenario.adjacency[selectedRegion.regionId] ?? []).join(", ") || "—"}</div>
              <div style={{ marginTop: 6 }}>
                <div className="gs-faint">Войска здесь ({unitsHere.length})</div>
                {unitsHere.length === 0 ? (
                  <div className="gs-faint">— нет —</div>
                ) : (
                  unitsHere.map((u) => (
                    <div key={u.unitId} className="gs-kv"><span>{u.unitId} · {u.countryId}</span><span>{u.personnel} чел. {u.daysUntilReady > 0 ? `· ⏳ ${u.daysUntilReady} дн.` : "· готов"}</span></div>
                  ))
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <div className="gs-faint">Стройки ({regionProjects.length})</div>
                {regionProjects.length === 0 ? <div className="gs-faint">— нет —</div> : regionProjects.map((p) => (
                  <div key={p.id} className="gs-kv"><span>{p.type} · {p.regionId}</span><span>{p.status === "active" ? `до ${p.endDate}` : "завершена"}</span></div>
                ))}
              </div>
            </div>
          ) : (
            <div className="gs-card">
              <span className="gs-muted">Выберите регион на карте, чтобы увидеть владельца, контролёра, войска и стройки.</span>
            </div>
          )}

          {/* ИИ-статус: кратко для всех, переключатель профиля только в DEV */}
          {(() => {
            const isPlayer = playerCountryId === selectedCountry.countryId;
            let aiProfile = "—";
            try { aiProfile = sim.getAiProfile(selectedCountry.countryId) ?? aiProfile; } catch { /* noop */ }
            if (aiProfile === "—") {
              const order = ["AT","BY","CZ","DE","ES","FR","GB","GR","HU","IT","PL","RO","RS","SE","TR","UA"];
              aiProfile = order.indexOf(selectedCountry.countryId) % 2 === 0 ? "cautious" : "ambitious";
            }
            let aiLast: number | undefined;
            try { aiLast = sim.getAiLastRun(selectedCountry.countryId) ?? undefined; } catch { aiLast = undefined; }
            const aiEvents = sim.getEventLog().filter((e) => e.kind === "aiDecision" && (e.payload as { countryId?: string })?.countryId === selectedCountry.countryId).slice(-1).reverse();
            return (
              <div className="gs-card">
                <div className="gs-row" style={{ justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 12 }}>ИИ — {isPlayer ? "игрок (ИИ выкл.)" : `профиль ${aiProfile}`}</strong>
                  <span className="gs-tag dim">{isPlayer ? "вы" : aiProfile === "cautious" ? "осторожный" : "амбициозный"}</span>
                </div>
                <div className="gs-faint" style={{ marginTop: 4 }}>
                  {isPlayer
                    ? "ИИ за вашу страну не ходит. Остальные — каждые 14 дн. + по событиям, по тем же правилам."
                    : `Последний ход: ${aiLast !== undefined ? `день ${aiLast}` : "— ещё не ходил"}.`}
                </div>
                {!isPlayer && isDevMode && (
                  <div className="gs-row" style={{ marginTop: 6 }}>
                    <button className="gs-btn small" onClick={() => useGameStore.getState().setAiProfile(selectedCountry.countryId, "cautious")} data-testid={`btn-ai-profile-cautious-${selectedCountry.countryId}`} aria-pressed={aiProfile === "cautious"}>
                      Осторожный
                    </button>
                    <button className="gs-btn small" onClick={() => useGameStore.getState().setAiProfile(selectedCountry.countryId, "ambitious")} data-testid={`btn-ai-profile-ambitious-${selectedCountry.countryId}`} aria-pressed={aiProfile === "ambitious"}>
                      Амбициозный
                    </button>
                  </div>
                )}
                {!isPlayer && !isDevMode && <div className="gs-faint" style={{ marginTop: 4 }}>Переключение профиля — в DEV-режиме.</div>}
                {aiEvents.length > 0 && (
                  <div className="gs-faint" style={{ marginTop: 6 }}>Последнее решение: {aiEvents[0].message}</div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
