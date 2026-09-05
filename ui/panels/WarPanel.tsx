import { useState, useMemo } from "react";
import { useGameStore } from "../store.js";
import ru from "../locales/ru.json";

const t = ru as Record<string, string>;

/**
 * WarPanel — minimal UI for T6 war and peace A (part of #1, closes #7)
 * Mount contract: <WarPanel />
 * Uses store sim via zustand. Shows declareWar with visible cost/consequences,
 * proposePeace with 3 options (white/annexOccupied/indemnity) and AI reasons.
 * No alliances in A — explicit text.
 */

export default function WarPanel() {
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const scenario = useGameStore((s) => s.scenario);
  const [attacker, setAttacker] = useState<string>("GB");
  const [defender, setDefender] = useState<string>("FR");
  const [msg, setMsg] = useState<string>("");
  const [peaceWarId, setPeaceWarId] = useState<string>("");
  const [peaceProposer, setPeaceProposer] = useState<string>("GB");
  const [peaceType, setPeaceType] = useState<"white" | "annexOccupied" | "indemnity">("white");

  const wars = sim.getWarsSnapshot();
  const activeWars = wars.filter((w) => w.status === "active");
  const threats = sim.getAllThreats();

  const declareForecast = useMemo(() => {
    try {
      return sim.forecastDeclareWar(attacker, defender);
    } catch {
      return null;
    }
  }, [sim, attacker, defender, wars.length]);

  const peaceForecast = useMemo(() => {
    if (!peaceWarId) return null;
    try {
      return sim.forecastPeace(peaceWarId, peaceProposer, peaceType as unknown as import("../../sim/war.js").PeaceType);
    } catch {
      return null;
    }
  }, [sim, peaceWarId, peaceProposer, peaceType, wars.length, sim.getDaysElapsed()]);

  const handleDeclare = () => {
    const res = dispatch({ type: "declareWar", payload: { attacker, defender, reason: "агрессия" } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ война ${attacker} → ${defender} объявлена (угроза +15, союзов нет — автовтягивания нет)`);
  };

  const handlePeace = () => {
    if (!peaceWarId) {
      setMsg("❌ укажите warId");
      return;
    }
    const res = dispatch({ type: "proposePeace", payload: { warId: peaceWarId, proposer: peaceProposer, type: peaceType } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else {
      // check log for accept/reject
      const tail = sim.getEventLogTail(5);
      const lastPeace = [...tail].reverse().find((e) => e.kind === "peaceAccepted" || e.kind === "peaceRejected");
      if (lastPeace) setMsg(`✓ ${lastPeace.kind}: ${lastPeace.message}`);
      else setMsg(`✓ предложение мира ${peaceType} по ${peaceWarId} отправлено`);
    }
  };

  return (
    <div data-testid="war-panel" style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t["war.title"] ?? "Война и мир"}</h3>
      <p style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>{t["war.hint"] ?? "Объявление войны с видимой ценой, 3 опции мира. Юрвладелец меняется только миром (оккупация ≠ аннексия). Агрессия растит угрозу. Союзов нет (A) — автовтягивания нет."}</p>

      {/* threats */}
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
        Угроза (для ИИ T8): {Object.entries(threats).slice(0, 8).map(([cid, v]) => <span key={cid} style={{ marginRight: 8 }}>{cid}:{v}</span>)}
      </div>

      {/* declare */}
      <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Объявить войну</strong>
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            Атакующий
            <select value={attacker} onChange={(e) => setAttacker(e.target.value)}>
              {scenario.countries.map((c) => <option key={c.countryId} value={c.countryId}>{c.countryId}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            Защитник
            <select value={defender} onChange={(e) => setDefender(e.target.value)}>
              {scenario.countries.map((c) => <option key={c.countryId} value={c.countryId}>{c.countryId}</option>)}
            </select>
          </label>
          <button onClick={handleDeclare} data-testid="btn-declare-war">{t["war.declare"] ?? "Объявить войну"}</button>
        </div>
        {declareForecast ? (
          <div style={{ marginTop: 6, fontSize: 11, background: declareForecast.ok ? "#e6ffe6" : "#ffe6e6", border: "1px solid #ddd", borderRadius: 4, padding: 6 }}>
            <div><strong>Прогноз до подтверждения:</strong> {declareForecast.ok ? "доступно" : `недоступно — ${declareForecast.unavailableReason}`}</div>
            <div>Цена: казна {declareForecast.cost.treasury}₥, угроза +{declareForecast.cost.threatDelta}</div>
            <div>Последствия: {declareForecast.consequences.join("; ")}</div>
            <div style={{ opacity: 0.7 }}>{declareForecast.reason}</div>
          </div>
        ) : null}
      </div>

      {/* wars list */}
      <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>Активные войны ({activeWars.length})</strong>
        {activeWars.length === 0 ? <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{t["war.noWars"] ?? "нет активных войн"}</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
            {activeWars.map((w) => (
              <div key={w.warId} style={{ border: "1px solid #f0f0f0", borderRadius: 4, padding: 6, fontSize: 12 }}>
                <strong>{w.warId}</strong> {w.attackerId} → {w.defenderId} · день {w.startDay} ({w.startDate}) · дни {w.daysAtWar} · истощение {w.attackerId}:{w.exhaustionAttacker.toFixed(0)} {w.defenderId}:{w.exhaustionDefender.toFixed(0)}
                <div style={{ fontSize: 11, opacity: 0.7 }}>оккупировано {w.attackerId}: {w.occupiedByAttacker.join(", ") || "—"} | {w.defenderId}: {w.occupiedByDefender.join(", ") || "—"}</div>
                <button
                  style={{ marginTop: 4, fontSize: 11 }}
                  onClick={() => { setPeaceWarId(w.warId); setPeaceProposer(w.attackerId); }}
                >
                  Выбрать для мира
                </button>
              </div>
            ))}
          </div>
        )}
        {wars.filter((w) => w.status === "ended").length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
            Завершённые: {wars.filter((w) => w.status === "ended").map((w) => `${w.warId} ${w.attackerId}↔${w.defenderId} (${w.endReason})`).join(", ")}
          </div>
        ) : null}
      </div>

      {/* propose peace */}
      <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
        <strong style={{ fontSize: 13 }}>Предложить мир</strong>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            warId
            <input value={peaceWarId} onChange={(e) => setPeaceWarId(e.target.value)} placeholder="war-1" style={{ width: 100 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            Предлагает
            <select value={peaceProposer} onChange={(e) => setPeaceProposer(e.target.value)}>
              {scenario.countries.map((c) => <option key={c.countryId} value={c.countryId}>{c.countryId}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            Тип
            <select value={peaceType} onChange={(e) => setPeaceType(e.target.value as never)}>
              <option value="white">белый мир</option>
              <option value="annexOccupied">аннексия оккупированного</option>
              <option value="indemnity">контрибуция (250₥)</option>
            </select>
          </label>
          <button onClick={handlePeace} data-testid="btn-propose-peace">Предложить мир</button>
        </div>
        {peaceForecast ? (
          <div style={{ marginTop: 6, fontSize: 11, background: "#f7f7ff", border: "1px solid #ddd", borderRadius: 4, padding: 6 }}>
            <div>Доступно: {peaceForecast.ok ? "да" : `нет — ${peaceForecast.reason}`}</div>
            {peaceForecast.aiPreview ? (
              <>
                <div>ИИ {peaceForecast.aiPreview.accept ? "согласится" : "откажется"}: {peaceForecast.aiPreview.reasons.join("; ")}</div>
                <div style={{ opacity: 0.7 }}>Соотношение сил, истощение, оккупация — топ-2 причины показаны</div>
              </>
            ) : null}
          </div>
        ) : (
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>Выберите войну и сторону для прогноза ИИ</div>
        )}
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6, lineHeight: 1.3 }}>
          {t["war.peaceHint"] ?? "Белый — статус-кво. Аннексия — контролёр→владелец для оккупированного. Контрибуция — перевод казны. Юрвладелец только миром."}
        </div>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 13, border: "1px solid #ddd", padding: 6, borderRadius: 4, background: "#fafafa" }}>{msg}</div> : null}

      {/* map hint */}
      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7, background: "#fff7e6", border: "1px solid #ffe0b2", borderRadius: 6, padding: 6 }}>
        <strong>Обязательства (A):</strong> союзов нет — автовтягивания в чужие наступательные войны нет. Каждая война двусторонняя. Заготовка под B.
      </div>
    </div>
  );
}
