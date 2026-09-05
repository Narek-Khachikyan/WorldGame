import { useState, useMemo } from "react";
import { useGameStore } from "../store.js";
import LeaderAvatar from "../LeaderAvatar.js";
import type { SimEngine } from "../../sim/engine.js";
import { REGIME_IDS } from "../../sim/politics.js";
import ru from "../locales/ru.json";

const t = ru as Record<string, string>;

interface Props {
  countryId: string;
  sim?: SimEngine;
}

/**
 * PoliticsPanel — minimal UI for T7 politics end-to-end (part of #1, closes #8)
 * Mount contract: <PoliticsPanel countryId={selectedCountryId} /> or <PoliticsPanel sim={sim} countryId={...} />
 * Uses sim queries getPoliticalState/forecastRegimeChange/forecastLeaderChange/forecastElection and commands changeRegime/changeLeader.
 * Shows forecast before confirm, respects cost/lag/cooldown/bans, no AI regime change.
 */
export default function PoliticsPanel({ countryId, sim: simProp }: Props) {
  const storeSim = useGameStore((s) => s.sim);
  const scenario = useGameStore((s) => s.scenario);
  const dispatch = useGameStore((s) => s.dispatch);
  const sim = simProp ?? storeSim;
  const [msg, setMsg] = useState<string>("");
  const [pendingRegime, setPendingRegime] = useState<string>("electoralDemocracy");
  const [pendingLeader, setPendingLeader] = useState<string>("");

  const political = sim.getPoliticalState(countryId);
  const economy = sim.getEconomy(countryId);
  const countryMeta = scenario.countries.find((c) => c.countryId === countryId);
  const leadersEntry = scenario.leaders.find((l) => l.countryId === countryId);
  const pool = leadersEntry ? leadersEntry.pool.map((p) => p.name) : [];
  const allLeaders = leadersEntry ? [leadersEntry.incumbent.name, ...pool] : [];

  const regimeForecast = useMemo(() => {
    if (!political) return null;
    try {
      return sim.forecastRegimeChange(countryId, pendingRegime);
    } catch {
      return null;
    }
  }, [sim, countryId, pendingRegime, political?.regime, political?.regimeCooldownUntil, political?.pendingRegimeChange, sim.getDate(), economy?.treasury]);

  const leaderForecast = useMemo(() => {
    if (!political || !pendingLeader) return null;
    try {
      return sim.forecastLeaderChange(countryId, pendingLeader);
    } catch { return null; }
  }, [sim, countryId, pendingLeader, political?.leaderId]);

  const electionForecast = useMemo(() => {
    try {
      return sim.forecastElection(countryId);
    } catch { return null; }
  }, [sim, countryId, political?.support, political?.stability, political?.warFatigueLite, political?.nextElectionDate]);

  if (!political || !countryMeta) return <div style={{ fontSize: 12, opacity: 0.6 }}>нет данных политики для {countryId}</div>;

  const regimeRu: Record<string, string> = {
    liberalDemocracy: "Либеральная демократия",
    electoralDemocracy: "Электоральная демократия",
    authoritarian: "Авторитарный",
    oneParty: "Однопартийный",
  };

  const handleRegime = () => {
    const res = dispatch({ type: "changeRegime", payload: { countryId, newRegime: pendingRegime } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ смена режима ${political.regime} → ${pendingRegime} запланирована (лаг 6–12 мес., кулдаун ~2г., запрет при войне/потере столицы)`);
  };

  const handleLeader = () => {
    if (!pendingLeader) { setMsg("❌ выберите лидера из пула"); return; }
    const res = dispatch({ type: "changeLeader", payload: { countryId, newLeaderId: pendingLeader } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ лидер ${political.leaderId} → ${pendingLeader} (косметика + дрейф поддержки)`);
  };

  const crisisLabel = political.crisisLevel === 2 ? "критический" : political.crisisLevel === 1 ? "предкризис" : "норма";
  const crisisColor = political.crisisLevel === 2 ? "#fee2e2" : political.crisisLevel === 1 ? "#fef3c7" : "#f0fdf4";
  const crisisBorder = political.crisisLevel === 2 ? "#fecaca" : political.crisisLevel === 1 ? "#fde68a" : "#bbf7d0";

  return (
    <div data-testid="politics-panel" style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, fontSize: 12, background: "#fff" }}>
      <h3 style={{ marginTop: 0 }}>{t["politics.title"] ?? "Политика"}</h3>
      <p style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.35 }}>{t["politics.hint"] ?? "4 игровых режима с числами в rules/, лидеры с лицами (инициалы), смена режима как дорогое решение (лаг, кулдаун, запрет при войне/потере столицы), выборы каждые 5 лет в свою дату."}</p>

      {/* Current regime + leader */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 10, background: "#f9fafb" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <LeaderAvatar name={political.leaderId} title={political.leaderTitle} size={42} portrait={null} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{political.leaderId}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>{political.leaderTitle} · партия {political.partyId} · режим {regimeRu[political.regime] ?? political.regime}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{countryMeta.nameRu} · {countryMeta.capital} · остров {countryMeta.island ? "да" : countryMeta.landlocked ? "landlocked" : "нет"}</div>
          </div>
          <span style={{ fontSize: 10, background: "#e0e7ff", border: "1px solid #c7d2fe", padding: "2px 6px", borderRadius: 999 }}>{political.regime}</span>
        </div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
          <div><strong>Стабильность:</strong> {political.stability.toFixed(1)} <span style={{ opacity: 0.6 }}>({crisisLabel})</span></div>
          <div><strong>Поддержка:</strong> {political.support.toFixed(1)}</div>
          <div><strong>Усталость:</strong> {political.warFatigueLite.toFixed(1)}</div>
          <div><strong>Партия:</strong> {political.partyId}</div>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, opacity: 0.6, marginTop: 4 }}>Стабильность/поддержка зависят от налогов, соцрасходов, дефицитов, реформ, потерь, длительности войны, оккупации. Низкая → постепенный кризис с шансом восстановления, не instant death.</div>
        </div>
        {/* crisis banner */}
        <div style={{ marginTop: 8, background: crisisColor, border: `1px solid ${crisisBorder}`, borderRadius: 6, padding: 6, fontSize: 11 }}>
          <strong>Статус кризиса:</strong> {crisisLabel} · стабильность {political.stability.toFixed(1)} {political.stability < 30 ? "⚠ требуется действие (налоги/соц/мир)" : "в норме"} {political.pendingRegimeChange ? `· 🔄 смена режима → ${political.pendingRegimeChange.newRegime} вступит ${political.pendingRegimeChange.effectiveDate}` : ""} {political.regimeCooldownUntil ? `· ⏳ кулдаун до ${political.regimeCooldownUntil}` : ""}
          {political.stability < 30 ? <div style={{ marginTop: 4, color: "#991b1b" }}>{t["politics.crisisHint"] ?? "Крах без предупреждения невозможен — журнал показывает crisisWarning загодя. Низкая стабильность = постепенный дрейф −X/день с шансом восстановления."}</div> : null}
        </div>
        {/* regime effects */}
        <div style={{ marginTop: 8, fontSize: 11, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: 6 }}>
          <strong>Эффекты режима ({regimeRu[political.regime]} — игровой ярлык, числа в rules/politics.json):</strong>
          <div style={{ marginTop: 4, lineHeight: 1.4 }}>{(() => { const eff = (political as unknown as { regime:string }).regime; return `Бонус удержания на выборах + удержание, налоговая эффективность, усталость × фактор, конкурентность — модельные коэффициенты, не статистика.`; })()}</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>ИИ в A режим сам не меняет (фикс).</div>
        </div>
      </div>

      {/* Elections */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Выборы</strong>
        <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
          Дата: <strong>{String(countryMeta.electionDay).padStart(2, "0")}.{String(countryMeta.electionMonth).padStart(2, "0")}</strong> каждые 5 лет · ближайшие: <strong>{political.nextElectionDate}</strong> {political.lastElectionDate ? `· последние ${political.lastElectionDate}` : ""}
        </div>
        {electionForecast ? (
          <div style={{ marginTop: 6, fontSize: 11, background: electionForecast.retainP < 0.55 ? "#fef3c7" : "#f0fdf4", border: "1px solid #ddd", borderRadius: 4, padding: 6 }}>
            <div><strong>Прогноз удержания (до бросока RNG):</strong> {(electionForecast.retainP*100).toFixed(1)}% · {electionForecast.breakdown}</div>
            <div style={{ marginTop: 4 }}>Причины: {electionForecast.reasons.join("; ")}</div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>{electionForecast.retainP < 0.55 ? "⚠ риск смены партии высок" : "риск смены умеренный"} · {t["politics.electionHint"] ?? "Исход от поддержки/стабильности/усталости/экономики + seeded RNG + модификатор режима; демократии конкурентны, авторитарные — высокая retain, но провал бьёт по стабильности. Результат с причинами в журнале."}</div>
            <div style={{ marginTop: 4, fontSize: 10, opacity: 0.6, fontFamily: "monospace" }}>retainP = f(support, stability, fatigue, economy, regimeBonus, RNG)</div>
          </div>
        ) : null}
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, lineHeight: 1.3 }}>
          Смена партии → лидер из пула + foreignStance-дельты к отношениям/доверию + ИИ переоценит угрозы/сделки. Проигрыш игрока = смена лидера/партии + удар по стабильности, но не game-over.
        </div>
      </div>

      {/* Regime change */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Смена режима</strong>
        <p style={{ fontSize: 11, opacity: 0.7, margin: "4px 0 6px" }}>{t["politics.regimeHint"] ?? "Цена из казны, −стабильность сразу, эффект через 6–12 мес., кулдаун ~2 года, запрет при войне/потере столицы, прогноз до подтверждения."}</p>
        <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            Новый режим
            <select value={pendingRegime} onChange={(e) => setPendingRegime(e.target.value)}>
              {REGIME_IDS.map((r) => <option key={r} value={r}>{regimeRu[r] ?? r}</option>)}
            </select>
          </label>
          <button onClick={handleRegime} data-testid="btn-change-regime">Сменить режим</button>
        </div>
        {regimeForecast ? (
          <div style={{ marginTop: 6, fontSize: 11, background: regimeForecast.ok ? "#e6ffe6" : "#ffe6e6", border: "1px solid #ddd", borderRadius: 4, padding: 6 }}>
            <div><strong>Прогноз до подтверждения:</strong> {regimeForecast.ok ? "доступно" : `недоступно — ${regimeForecast.unavailableReason}`}</div>
            <div>Цена: казна {regimeForecast.cost.treasury}₥, стабильность −{regimeForecast.cost.stabilityPenalty}</div>
            {regimeForecast.ok ? <div>Лаг {regimeForecast.lagDays} дн. → {regimeForecast.effectiveDate} · кулдаун до {regimeForecast.cooldownUntil}</div> : null}
            <div style={{ opacity: 0.7, marginTop: 4 }}>{regimeForecast.reason}</div>
            <div style={{ marginTop: 4, fontSize: 10, opacity: 0.6 }}>Последствия: {regimeForecast.consequences.join("; ")}</div>
          </div>
        ) : null}
        {political.pendingRegimeChange ? <div style={{ marginTop: 6, fontSize: 11, background: "#fff7e6", border: "1px solid #ffe0b2", borderRadius: 4, padding: 6 }}>⏳ Ожидается: {political.regime} → {political.pendingRegimeChange.newRegime} вступит {political.pendingRegimeChange.effectiveDate} (день {political.pendingRegimeChange.effectiveDay})</div> : null}
      </div>

      {/* Leader/persona change inside regime */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Смена персоны внутри режима</strong>
        <p style={{ fontSize: 11, opacity: 0.7, margin: "4px 0 6px" }}>{t["politics.leaderHint"] ?? "Косметика + малый дрейф поддержки. Пул 1 действующий + 2–3 запасных на страну."} Текущий: <strong>{political.leaderId}</strong> ({political.leaderTitle})</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          {allLeaders.map((name) => (
            <button key={name} onClick={() => setPendingLeader(name)} style={{ padding: "4px 8px", borderRadius: 6, border: pendingLeader === name ? "2px solid #93c5fd" : "1px solid #e5e7eb", background: pendingLeader === name ? "#eff6ff" : "#fff", fontSize: 12 }}>
              {name} {name === political.leaderId ? "✓" : ""}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={pendingLeader} onChange={(e) => setPendingLeader(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">— выберите из пула —</option>
            {pool.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={handleLeader} data-testid="btn-change-leader">Сменить лидера</button>
        </div>
        {leaderForecast ? (
          <div style={{ marginTop: 6, fontSize: 11, background: leaderForecast.ok ? "#f0fdf4" : "#ffe6e6", border: "1px solid #ddd", borderRadius: 4, padding: 6 }}>
            {leaderForecast.ok ? <div>Дрейф поддержки {leaderForecast.supportDrift} · {leaderForecast.reason}</div> : <div>Недоступно: {leaderForecast.unavailableReason}</div>}
          </div>
        ) : null}
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {leadersEntry ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <LeaderAvatar name={leadersEntry.incumbent.name} size={28} portrait={leadersEntry.incumbent.portrait ?? null} />
                <span>{leadersEntry.incumbent.name} — {leadersEntry.incumbent.title}</span>
              </div>
              {leadersEntry.pool.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <LeaderAvatar name={p.name} size={28} portrait={(p as unknown as {portrait?:string}).portrait ?? null} />
                  <span>{p.name} — {p.title}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
        <div style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>Портреты — только свободные лицензии локально (data/portraits) + атрибуция; иначе инициалы, без хотлинков. См. data/attribution.md</div>
      </div>

      {/* Diplomacy stance deltas */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>Дипломатия / stance-дельты</strong>
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>При смене партии применяются foreignStance дельты (−20…+20) к отношениям/доверию. ИИ переоценит сделки/угрозу.</div>
        <div style={{ marginTop: 6, fontSize: 11, maxHeight: 120, overflowY: "auto", background: "#f9fafb", border: "1px solid #eee", borderRadius: 4, padding: 6 }}>
          {(() => {
            const parties = scenario.parties.filter((p) => p.countryId === countryId);
            const curParty = parties.find((p) => p.partyId === political.partyId);
            if (!curParty) return <span style={{ opacity: 0.6 }}>нет foreignStance</span>;
            const entries = Object.entries(curParty.foreignStance).sort((a, b) => b[1] - a[1]).slice(0, 8);
            return entries.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span style={{ color: v>=0?"#065f46":"crimson" }}>{v>=0?`+${v}`:v}</span></div>);
          })()}
        </div>
        <div style={{ marginTop: 6, fontSize: 11 }}>
          Отношения и доверие (направленные, 0–100, нейтраль 50): {(() => { const keys = Object.keys(sim.getSnapshot().politics?.relations ?? {}).filter(k=>k.startsWith(`${countryId}->`)).slice(0,3); return keys.length? keys.map(k=>`${k}:${sim.getSnapshot().politics?.relations[k]}`).join(" · ") : "—"; })()}
        </div>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 12, border: "1px solid #ddd", padding: 6, borderRadius: 4, background: "#fafafa" }}>{msg}</div> : null}

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7, background: "#fff7e6", border: "1px solid #ffe0b2", borderRadius: 6, padding: 6 }}>
        <strong>Гарантии (A):</strong> ИИ режим не меняет. Крах без предупреждения невозможен — при стабильности &lt;30 журнал даёт crisisWarning заранее, кризис — постепенный дрейф с шансом восстановления, не instant death. Проигрыш выборов игрока = смена лидера/партии + удар по стабильности, но игра продолжается.
      </div>
    </div>
  );
}
