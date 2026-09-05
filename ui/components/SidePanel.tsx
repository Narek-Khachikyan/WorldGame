import { useMemo } from "react";
import { useGameStore } from "../store.js";
import { getProfileForCountry } from "../data/countryProfiles.js";
import ru from "../locales/ru.json";
import PoliticsPanel from "../panels/PoliticsPanel.js";
import LeaderAvatar from "../LeaderAvatar.js";

/**
 * Side contextual panel-stub.
 * Contracts for T4/T5/T7:
 *   - Economy: mount at <EconomyPanel countryId={selectedCountryId} /> (T4) — expects treasury/balance/tax/weights/projects
 *   - Army: mount at <ArmyPanel countryId={selectedCountryId} regionId={selectedRegionId} /> (T5) — units/orders/battle
 *   - Politics/Diplomacy: mount at <PoliticsPanel countryId={...} /> (T7)
 * For T3 these are placeholder tabs with disabled state + explanation, not dead buttons.
 */

export default function SidePanel() {
  const t = ru as Record<string, string>;
  const scenario = useGameStore((s) => s.scenario);
  const selectedCountryId = useGameStore((s) => s.selectedCountryId);
  const selectedRegionId = useGameStore((s) => s.selectedRegionId);
  const lastDate = useGameStore((s) => s.lastDate);
  const hasStarted = useGameStore((s) => s.hasStarted);
  const playerCountryId = useGameStore((s) => s.playerCountryId);

  const selectedCountry = useMemo(
    () => (selectedCountryId ? scenario.countries.find((c) => c.countryId === selectedCountryId) ?? null : null),
    [scenario.countries, selectedCountryId]
  );
  const selectedRegion = useMemo(
    () => (selectedRegionId ? scenario.regions.find((r) => r.regionId === selectedRegionId) ?? null : null),
    [scenario.regions, selectedRegionId]
  );
  const sim = useGameStore((s) => s.sim);
  const leaders = useMemo(
    () => (selectedCountry ? scenario.leaders.find((l) => l.countryId === selectedCountry.countryId) ?? null : null),
    [scenario.leaders, selectedCountry]
  );

  const political = useMemo(() => {
    if (!selectedCountryId) return null;
    try { return sim.getPoliticalState(selectedCountryId); } catch { return null; }
  }, [sim, selectedCountryId, lastDate]);

  const regimeRu: Record<string, string> = {
    liberalDemocracy: "Либеральная демократия",
    electoralDemocracy: "Электоральная демократия",
    authoritarian: "Авторитарный",
    oneParty: "Однопартийный",
  };

  return (
    <div
      data-testid="side-panel"
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 10,
        background: "#ffffff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* header */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
        <strong style={{ fontSize: 13 }}>{t["side.title"] ?? "Контекст"}</strong>
        <span style={{ marginLeft: 8, fontSize: 11, color: "#6b7280" }}>{hasStarted ? "игра идёт" : "выбор страны"}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {!selectedCountry ? (
          <div style={{ padding: 14, border: "1px dashed #d1d5db", borderRadius: 10, background: "#fcfcf9", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Ничего не выбрано</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, lineHeight: 1.4 }}>
              Кликните страну или регион на карте. Карта подсвечивает выбор без пересоздания геометрии — только дифф.
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>Подсказка: двойной клик — сброс камеры.</div>
          </div>
        ) : (
          <>
            {/* country header */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {selectedCountry.countryId}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{selectedCountry.nameRu}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  {selectedCountry.capital} · {selectedCountry.island ? "остров" : selectedCountry.landlocked ? "landlocked" : "приморская"} · 4 региона
                </div>
                {playerCountryId === selectedCountry.countryId && (
                  <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 700, background: "#fef3c7", border: "1px solid #fcd34d", padding: "2px 6px", borderRadius: 999 }}>
                    ваша страна
                  </span>
                )}
              </div>
            </div>

            {/* position / strengths/risks */}
            {(() => {
              const p = getProfileForCountry(selectedCountry);
              return (
                <>
                  <div style={{ fontSize: 12, lineHeight: 1.45, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                    <strong>Положение:</strong> {p.position}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 9px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#065f46" }}>Сильные стороны</div>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 14, fontSize: 11, lineHeight: 1.35 }}>
                        {p.strengths.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 9px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#991b1b" }}>Риски</div>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 14, fontSize: 11, lineHeight: 1.35 }}>
                        {p.risks.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* leader — T7 real political state with initials avatar */}
            {(political ?? leaders) && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", display: "flex", gap: 10, alignItems: "center" }}>
                <LeaderAvatar name={political ? political.leaderId : leaders!.incumbent.name} title={political ? political.leaderTitle : leaders!.incumbent.title} size={36} portrait={null} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{political ? political.leaderId : leaders!.incumbent.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>{political ? political.leaderTitle : leaders!.incumbent.title} · {political ? `партия ${political.partyId} · ${regimeRu[political.regime] ?? political.regime}` : `с ${leaders!.incumbent.since}`}</div>
                  {political ? <div style={{ fontSize: 11, color: "#6b7280" }}>Стабильность {political.stability.toFixed(1)} · поддержка {political.support.toFixed(1)} · усталость {political.warFatigueLite.toFixed(0)} {political.crisisLevel===2?"· 🔴 критический":political.crisisLevel===1?"· 🟡 предкризис":"· 🟢 норма"}</div> : <div style={{ fontSize: 10, color: "#9ca3af" }}>Источник: {leaders!.incumbent.source.slice(0, 42)}…</div>}
                </div>
              </div>
            )}

            {/* election — T7 real */}
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>Выборы</div>
              <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>
                Дата: <strong>
                  {String(selectedCountry.electionDay).padStart(2, "0")}.{String(selectedCountry.electionMonth).padStart(2, "0")}
                </strong> каждые 5 лет · ближайшие: <strong>{political ? political.nextElectionDate : "—"}</strong> {political?.lastElectionDate ? `· последние ${political.lastElectionDate}` : ""}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.35 }}>
                Исход зависит от поддержки/стабильности/экономики + RNG и режима. Смена партии применит foreignStance-дельты к отношениям (Δ −20…+20).
                {political ? (()=>{ const fe = sim.forecastElection(selectedCountry.countryId); return fe ? ` Прогноз удержания: ${(fe.retainP*100).toFixed(1)}% · ${fe.breakdown}` : " Прогноз виден заранее (T7)."; })() : " Прогноз виден заранее (T7)."}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                Режим: {political ? `${regimeRu[political.regime] ?? political.regime} (игровой ярлык, числа в rules/politics.json)` : `${scenario.regimes[0].nameRu} (игровой ярлык)`} {political?.pendingRegimeChange ? `· ⏳ ${political.pendingRegimeChange.newRegime} вступит ${political.pendingRegimeChange.effectiveDate}` : ""} {political?.regimeCooldownUntil ? `· кулдаун до ${political.regimeCooldownUntil}` : ""}
              </div>
            </div>

            {/* PoliticsPanel full — embedded */}
            <div style={{ marginTop: 4 }}>
              <PoliticsPanel countryId={selectedCountry.countryId} />
            </div>

            {/* T8 AI status + profile selector — shows for AI-controlled (all except player) */}
            {(() => {
              const isPlayer = playerCountryId === selectedCountry.countryId;
              const aiProfile = sim.getAiProfile(selectedCountry.countryId) ?? ((): string => {
                // derive fallback via hash like ai.ts: even -> cautious
                const order = ["AT","BY","CZ","DE","ES","FR","GB","GR","HU","IT","PL","RO","RS","SE","TR","UA"];
                const idx = order.indexOf(selectedCountry.countryId);
                return idx % 2 === 0 ? "cautious" : "ambitious";
              })();
              const aiLast = sim.getAiLastRun(selectedCountry.countryId);
              const aiEvents = sim.getEventLog().filter((e)=> e.kind==="aiDecision" && (e.payload as {countryId?:string})?.countryId===selectedCountry.countryId).slice(-2).reverse();
              return (
                <div title="debug — профили внутренние, переключатель для тестирования (finding E)" style={{ border: `1px solid ${isPlayer ? "#e5e7eb" : "#c7d2fe"}`, borderRadius: 8, padding: "8px 10px", background: isPlayer ? "#f9fafb" : "#eff6ff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 12 }}>ИИ — {isPlayer ? "игрок (ИИ выкл.)" : `профиль ${aiProfile} (debug)`}</strong>
                    <span title="debug" style={{ fontSize: 10, background: isPlayer ? "#f3f4f6" : "#e0e7ff", border: "1px solid #c7d2fe", padding: "2px 6px", borderRadius: 999 }}>{isPlayer ? "вы" : aiProfile === "cautious" ? "осторожный" : "амбициозный"}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2, fontFamily: "monospace" }}>профили внутренние (hashCountryToProfile), UI — debug для тестирования; см. README.</div>
                  <div style={{ fontSize: 11, color: "#374151", marginTop: 4, lineHeight: 1.35 }}>
                    {isPlayer
                      ? "Эта страна под вашим управлением — ИИ за неё не ходит. Все остальные ИИ каждые 14 дн. + по событиям (война/мир/банкротство/выборы) действуют по тем же правилам: платят, строятся в срок, гарнизон столицы, экономика → война только при ~1.5× и выгоде. Теряет — просит мир."
                      : `ИИ ${aiProfile} (${aiProfile==="cautious" ? "1.8×, казна 600, долг ≤150" : "1.4×, казна 250, долг ≤350"}). Стратегия каждые 14 дн. + события. Послед. ход: ${aiLast !== undefined ? `день ${aiLast}` : "— ещё не ходил"}.`}
                  </div>
                  {!isPlayer ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={() => useGameStore.getState().setAiProfile(selectedCountry.countryId, "cautious")}
                        data-testid={`btn-ai-profile-cautious-${selectedCountry.countryId}`}
                        style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: aiProfile==="cautious" ? "1px solid #111827" : "1px solid #d1d5db", background: aiProfile==="cautious" ? "#111827" : "#fff", color: aiProfile==="cautious" ? "#fff" : "#111827", fontSize: 11 }}
                      >
                        Осторожный
                      </button>
                      <button
                        onClick={() => useGameStore.getState().setAiProfile(selectedCountry.countryId, "ambitious")}
                        data-testid={`btn-ai-profile-ambitious-${selectedCountry.countryId}`}
                        style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: aiProfile==="ambitious" ? "1px solid #92400e" : "1px solid #d1d5db", background: aiProfile==="ambitious" ? "#92400e" : "#fff", color: aiProfile==="ambitious" ? "#fff" : "#111827", fontSize: 11 }}
                      >
                        Амбициозный
                      </button>
                    </div>
                  ) : null}
                  {aiEvents.length>0 ? (
                    <div style={{ marginTop: 6, fontSize: 11, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: 6 }}>
                      <strong>Последнее ИИ решение:</strong>
                      {aiEvents.map((e)=> (
                        <div key={e.id} style={{ marginTop: 4, lineHeight: 1.35 }}>
                          <div style={{ fontSize: 10, opacity: 0.6 }}>{e.date} · {(e.payload as {cause?:string})?.cause}</div>
                          <div>{e.message}</div>
                          <div style={{ fontSize: 10, opacity: 0.7 }}>{JSON.stringify((e.payload as {reasons?:string[]})?.reasons?.slice(0,2))}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>Пока нет решений — подождите 14 дн. или событие (война/мир/выборы). Причины пишутся в журнал aiDecision.</div>
                  )}
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 6, fontFamily: "monospace" }}>ИИ хук: runAIStep(sim,countryId) каждые 14 дн. per country AI-controlled (all except playerCountryId) — см. sim/ai.ts + store tickReal. Без скрытых денег/подкреплений.</div>
                </div>
              );
            })()}

            {/* selected region details */}
            {selectedRegion ? (
              <div style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", background: "#f9fafb" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Регион</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                  {selectedRegion.nameRu} <span style={{ fontWeight: 400, color: "#6b7280" }}>({selectedRegion.regionId})</span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  Центр {selectedRegion.center[0].toFixed(2)}, {selectedRegion.center[1].toFixed(2)} · {selectedRegion.terrain === "mountains" ? "горы" : selectedRegion.terrain === "city" ? "город" : "равнина"}{" "}
                  {selectedRegion.isCapitalRegion ? "· ★ столичный" : ""} · generated
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>Соседей: {(scenario.adjacency[selectedRegion.regionId] ?? []).join(", ") || "—"}</div>
                {scenario.adjacency[selectedRegion.regionId]?.length === 0 && <div style={{ fontSize: 11, color: "#9ca3af" }}>Нет сухопутных соседей (остров/изоляция)</div>}
                {/* troops/orders placeholder */}
                <div style={{ marginTop: 8, padding: "6px 8px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 11, lineHeight: 1.4 }}>
                  <strong>Войска/приказы:</strong> <span style={{ color: "#6b7280" }}>нет данных — появится в T5 (группировка, лимиты, валидатор моря без переправы).</span>
                  <br />
                  <strong>Контролёр/владелец:</strong> владелец — {selectedCountry.nameRu} · контролёр — {selectedCountry.nameRu}{" "}
                  <span style={{ color: "#6b7280" }}>(оккупация ≠ аннексия; меняется только миром — T6)</span>
                </div>
                {/* mount contract hint for next tickets */}
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, fontFamily: "monospace" }}>
                  mount: ui/panels/ArmyPanel regionId={selectedRegion.regionId}
                </div>
              </div>
            ) : (
              <div style={{ border: "1px dashed #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                Выберите регион на карте, чтобы увидеть соседство, местность, столицу и заготовку для войск/контроля.
              </div>
            )}

            {/* stub panels for T4/T5/T7 — no dead buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#374151" }}>Панели следующих тикетов</div>

              {/* Economy stub */}
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "#f9fafb",
                  opacity: 0.92,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12 }}>Экономика</strong>
                  <span style={{ fontSize: 10, background: "#fef3c7", border: "1px solid #fcd34d", padding: "2px 6px", borderRadius: 999 }}>T4</span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.35 }}>
                  Налог, 4 веса, 3 типа строек — прогноз до подтверждения. Казна/баланс в топбаре пока «—».
                </div>
                <button
                  disabled
                  title="Доступно в T4 — экономика end-to-end (казна/доход/расход, помесячный тик, слоты региона)"
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#f3f4f6",
                    color: "#9ca3af",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "not-allowed",
                  }}
                >
                  Открыть экономику — в T4
                </button>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, fontFamily: "monospace" }}>mount: ui/panels/EconomyPanel countryId={selectedCountry.countryId}</div>
              </div>

              {/* Army stub */}
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "#f9fafb",
                  opacity: 0.92,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12 }}>Армия</strong>
                  <span style={{ fontSize: 10, background: "#e0e7ff", border: "1px solid #c7d2fe", padding: "2px 6px", borderRadius: 999 }}>T5</span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.35 }}>
                  Найм, снабжение, приказы по соседству, бой (оборона +25% + местность + ±10% RNG), оккупация.
                </div>
                <button
                  disabled
                  title="Доступно в T5 — армия end-to-end (валидатор моря без переправы, GB кейс)"
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#f3f4f6",
                    color: "#9ca3af",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "not-allowed",
                  }}
                >
                  Открыть армию — в T5
                </button>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, fontFamily: "monospace" }}>mount: ui/panels/ArmyPanel countryId/regionId</div>
              </div>

              {/* War/peace stub (T6) */}
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "#f9fafb",
                  opacity: 0.92,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12 }}>Война и мир</strong>
                  <span style={{ fontSize: 10, background: "#fee2e2", border: "1px solid #fecaca", padding: "2px 6px", borderRadius: 999 }}>T6</span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.35 }}>
                  Объявление войны и 3 опции мира (белый / аннексия / контрибуция). Владелец меняется только миром.
                </div>
                <button
                  disabled
                  title="Доступно в T6 — война/мир (причины согласия/отказа ИИ)"
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#f3f4f6",
                    color: "#9ca3af",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "not-allowed",
                  }}
                >
                  Дипломатия войны — в T6
                </button>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, fontFamily: "monospace" }}>mount: ui/panels/WarPanel</div>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: "8px 10px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", fontSize: 11, color: "#6b7280", lineHeight: 1.3 }}>
        Стиль — сдержанный политический атлас. Русский язык из <code>ui/locales/ru.json</code>. Монтирование панелей — по контрактам выше.
      </div>
    </div>
  );
}
