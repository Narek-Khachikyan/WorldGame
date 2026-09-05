import { useEffect, useMemo, useState } from "react";
import { useGameStore } from "../store.js";
import ru from "../locales/ru.json";

const t = ru as Record<string, string>;

/**
 * Дипломатия: объявление войны и мир. Атакующий по умолчанию — страна игрока.
 * Объявление войны требует подтверждения с видимой ценой и последствиями.
 */
export default function WarPanel({
  playerCountryId,
  selectedCountryId,
}: {
  playerCountryId?: string | null;
  selectedCountryId?: string | null;
}) {
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const scenario = useGameStore((s) => s.scenario);
  useGameStore((s) => s.stateRev);
  useGameStore((s) => s.lastDate);

  const player = playerCountryId ?? "GB";
  const [attacker, setAttacker] = useState<string>(player);
  const [defender, setDefender] = useState<string>(selectedCountryId && selectedCountryId !== player ? selectedCountryId : "FR");
  const [msg, setMsg] = useState<string>("");
  const [confirmWar, setConfirmWar] = useState(false);
  const [peaceWarId, setPeaceWarId] = useState<string>("");
  const [peaceProposer, setPeaceProposer] = useState<string>(player);
  const [peaceType, setPeaceType] = useState<"white" | "annexOccupied" | "indemnity">("white");

  useEffect(() => { setAttacker(player); setPeaceProposer(player); }, [player]);
  useEffect(() => {
    if (selectedCountryId && selectedCountryId !== player) setDefender(selectedCountryId);
  }, [selectedCountryId, player]);

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
    if (attacker !== player) {
      setMsg(`❌ Войну можно объявлять только от вашей страны (${player}).`);
      return;
    }
    if (!confirmWar) {
      setMsg("Подтвердите объявление войны: цена и последствия показаны выше.");
      return;
    }
    const res = dispatch({ type: "declareWar", payload: { attacker, defender, reason: "агрессия" } });
    setConfirmWar(false);
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
      const tail = sim.getEventLogTail(5);
      const lastPeace = [...tail].reverse().find((e) => e.kind === "peaceAccepted" || e.kind === "peaceRejected");
      if (lastPeace) setMsg(`✓ ${lastPeace.kind}: ${lastPeace.message}`);
      else setMsg(`✓ предложение мира ${peaceType} по ${peaceWarId} отправлено`);
    }
  };

  return (
    <div data-testid="war-panel" className="gs-card">
      <h3>{t["war.title"] ?? "Война и мир"}</h3>
      <p className="gs-muted" style={{ fontSize: 11 }}>{t["war.hint"] ?? "Объявление войны с видимой ценой, 3 опции мира."}</p>

      <div className="gs-faint" style={{ marginBottom: 8 }}>
        Угроза: {Object.entries(threats).slice(0, 8).map(([cid, v]) => <span key={cid} style={{ marginRight: 8 }}>{cid}:{v}</span>)}
      </div>

      <div className="gs-card">
        <strong style={{ fontSize: 13 }}>Объявить войну — от {player}</strong>
        <div className="gs-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            Защитник
            <select value={defender} onChange={(e) => { setDefender(e.target.value); setConfirmWar(false); }} data-testid="war-defender">
              {scenario.countries.filter((c) => c.countryId !== player).map((c) => <option key={c.countryId} value={c.countryId}>{c.countryId} {c.nameRu}</option>)}
            </select>
          </label>
          <button onClick={handleDeclare} data-testid="btn-declare-war" className="gs-btn primary" disabled={!!declareForecast && !declareForecast.ok}>
            {t["war.declare"] ?? "Объявить войну"}
          </button>
        </div>
        {declareForecast ? (
          <div className="gs-card" style={{ marginTop: 6, borderColor: declareForecast.ok ? "#2f5a3c" : "#6e2f28" }}>
            <div><strong>Цена и последствия:</strong> {declareForecast.ok ? "доступно" : `недоступно — ${declareForecast.unavailableReason}`}</div>
            <div>Цена: казна {declareForecast.cost.treasury}₥, угроза +{declareForecast.cost.threatDelta}</div>
            <div>Последствия: {declareForecast.consequences.join("; ")}</div>
            <div className="gs-faint">{declareForecast.reason}</div>
            {declareForecast.ok && (
              <label className="gs-row" style={{ marginTop: 6, fontSize: 12 }}>
                <input type="checkbox" checked={confirmWar} onChange={(e) => setConfirmWar(e.target.checked)} data-testid="war-confirm" />
                Понимаю цену и последствия, подтверждаю войну {player} → {defender}
              </label>
            )}
          </div>
        ) : null}
      </div>

      <div className="gs-card" style={{ marginTop: 8 }}>
        <strong style={{ fontSize: 12 }}>Активные войны ({activeWars.length})</strong>
        {activeWars.length === 0 ? <div className="gs-muted" style={{ marginTop: 4 }}>{t["war.noWars"] ?? "нет активных войн"}</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
            {activeWars.map((w) => (
              <div key={w.warId} className="gs-card">
                <strong>{w.warId}</strong> {w.attackerId} → {w.defenderId} · дни {w.daysAtWar} · истощение {w.attackerId}:{w.exhaustionAttacker.toFixed(0)} {w.defenderId}:{w.exhaustionDefender.toFixed(0)}
                <div className="gs-faint">оккупировано {w.attackerId}: {w.occupiedByAttacker.join(", ") || "—"} | {w.defenderId}: {w.occupiedByDefender.join(", ") || "—"}</div>
                <button className="gs-btn small" style={{ marginTop: 4 }} onClick={() => { setPeaceWarId(w.warId); setPeaceProposer(w.attackerId); }}>
                  Выбрать для мира
                </button>
              </div>
            ))}
          </div>
        )}
        {wars.filter((w) => w.status === "ended").length > 0 ? (
          <div className="gs-faint" style={{ marginTop: 8 }}>
            Завершённые: {wars.filter((w) => w.status === "ended").map((w) => `${w.warId} ${w.attackerId}↔${w.defenderId} (${w.endReason})`).join(", ")}
          </div>
        ) : null}
      </div>

      <div className="gs-card" style={{ marginTop: 8 }}>
        <strong style={{ fontSize: 13 }}>Предложить мир</strong>
        <div className="gs-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            warId
            <input value={peaceWarId} onChange={(e) => setPeaceWarId(e.target.value)} placeholder="war-1" style={{ width: 90 }} aria-label="warId" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            Предлагает
            <select value={peaceProposer} onChange={(e) => setPeaceProposer(e.target.value)}>
              {scenario.countries.map((c) => <option key={c.countryId} value={c.countryId}>{c.countryId}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            Тип
            <select value={peaceType} onChange={(e) => setPeaceType(e.target.value as never)}>
              <option value="white">белый мир</option>
              <option value="annexOccupied">аннексия оккупированного</option>
              <option value="indemnity">контрибуция (250₥)</option>
            </select>
          </label>
          <button onClick={handlePeace} data-testid="btn-propose-peace" className="gs-btn">Предложить мир</button>
        </div>
        {peaceForecast ? (
          <div className="gs-card" style={{ marginTop: 6 }}>
            <div>Доступно: {peaceForecast.ok ? "да" : `нет — ${peaceForecast.reason}`}</div>
            {peaceForecast.aiPreview ? (
              <div>ИИ {peaceForecast.aiPreview.accept ? "согласится" : "откажется"}: {peaceForecast.aiPreview.reasons.join("; ")}</div>
            ) : null}
          </div>
        ) : (
          <div className="gs-faint" style={{ marginTop: 6 }}>Выберите войну и сторону для прогноза ИИ</div>
        )}
        <div className="gs-faint" style={{ marginTop: 6 }}>
          {t["war.peaceHint"] ?? "Белый — статус-кво. Аннексия — контролёр→владелец для оккупированного. Контрибуция — перевод казны."}
        </div>
      </div>

      {msg ? <div className="gs-card" style={{ marginTop: 8 }}>{msg}</div> : null}

      <div className="gs-faint" style={{ marginTop: 8 }}>
        Союзов нет — автовтягивания в чужие войны нет. Каждая война двусторонняя.
      </div>
    </div>
  );
}
