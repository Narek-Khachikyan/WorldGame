import { useEffect, useState } from "react";
import { useGameStore } from "./store.js";
import { calculateBaseStrength, dailyUpkeepCost } from "../sim/army.js";
import ru from "./locales/ru.json";

const t = ru as Record<string, string>;

export default function ArmyPanel({ playerCountryId }: { playerCountryId?: string | null }) {
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  useGameStore((s) => s.stateRev);
  useGameStore((s) => s.lastDate);
  const military = sim.getMilitaryLayer();
  const regions = sim.getRegionStates();
  const countries = sim.getScenario().countries;

  const player = playerCountryId ?? "GB";
  const [hireCountry, setHireCountry] = useState<string>(player);
  const [hireRegion, setHireRegion] = useState<string>(`${player}-1`);
  const [hirePersonnel, setHirePersonnel] = useState<string>("1000");
  const [hireEquipment, setHireEquipment] = useState<string>("0.8");
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>("");

  // Раздел армии всегда управляет страной игрока: внешние переключения не подменяют её.
  useEffect(() => {
    setHireCountry(player);
    const first = sim.getScenario().regions.find((r) => r.countryId === player);
    if (first) setHireRegion(first.regionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const handleHire = () => {
    if (hireCountry !== player) {
      setMsg(`❌ Найм доступен только для вашей страны (${player}). Чужими армиями управлять нельзя.`);
      return;
    }
    const personnel = parseInt(hirePersonnel, 10);
    const equipment = parseFloat(hireEquipment);
    const res = dispatch({ type: "recruitUnit", payload: { countryId: hireCountry, regionId: hireRegion, personnel, equipment } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ ${t["army.hired"] ?? "наём запущен"} ${hireCountry} ${hireRegion} ${personnel} чел.`);
  };

  const handleMove = (unitId: string) => {
    const to = moveTargets[unitId];
    if (!to) {
      setMsg("❌ укажите регион");
      return;
    }
    const unit = sim.getUnit(unitId);
    if (!unit || unit.countryId !== player) {
      setMsg(`❌ Приказы доступны только вашим войскам (${player}).`);
      return;
    }
    const res = dispatch({ type: "moveUnit", payload: { unitId, toRegionId: to } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ ${t["army.moved"] ?? "перемещение"} ${unitId} → ${to}`);
  };

  const handleStance = (unitId: string, stance: string) => {
    const unit = sim.getUnit(unitId);
    if (!unit || unit.countryId !== player) {
      setMsg(`❌ Стойку можно менять только у ваших войск (${player}).`);
      return;
    }
    const res = dispatch({ type: "setStance", payload: { unitId, stance } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ стойка ${unitId} → ${stance}`);
  };

  const myUnits = military.units.filter((u) => u.countryId === player);

  return (
    <div data-testid="army-panel" className="gs-card">
      <h3>{t["army.title"] ?? "Армия — группировки"} · {player}</h3>
      <p className="gs-muted" style={{ fontSize: 11 }}>{t["army.hint"] ?? "Найм ограничен населением/оснащением/бюджетом/временем."}</p>

      {/* hiring — только своя страна */}
      <div className="gs-card" style={{ marginTop: 8 }}>
        <h4>Найм — {player}</h4>
        <div className="gs-row" style={{ flexWrap: "wrap", marginTop: 6 }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            Регион
            <select value={hireRegion} onChange={(e) => setHireRegion(e.target.value)} data-testid="army-hire-region">
              {sim.getScenario().regions.filter((r) => r.countryId === player).map((r) => (
                <option key={r.regionId} value={r.regionId}>{r.regionId} {r.terrain} {r.isCapitalRegion ? "★" : ""}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            Состав
            <input value={hirePersonnel} onChange={(e) => setHirePersonnel(e.target.value)} style={{ width: 80 }} placeholder="500-5000" aria-label="Состав" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
            Оснащение
            <input value={hireEquipment} onChange={(e) => setHireEquipment(e.target.value)} style={{ width: 80 }} placeholder="0.5-1.0" aria-label="Оснащение" />
          </label>
          <button className="gs-btn primary" onClick={handleHire}>{t["army.hire"] ?? "Нанять (14 дн.)"}</button>
        </div>
        <div className="gs-faint" style={{ marginTop: 4 }}>Чужие страны здесь не нанимают — найм только для {player}.</div>
      </div>

      {/* units — свои */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
        {myUnits.length === 0 ? (
          <em className="gs-muted">{t["army.noUnits"] ?? "нет отрядов — наймите первый"}</em>
        ) : (
          myUnits.map((u) => {
            const rs = regions.find((r) => r.regionId === u.regionId);
            const strength = calculateBaseStrength(u);
            const upkeep = dailyUpkeepCost(u);
            return (
              <div key={u.unitId} className="gs-card">
                <div><strong>{u.unitId}</strong> @ {u.regionId} {rs?.isCapitalRegion ? "★ столица" : ""} | {u.personnel} чел. ×{u.equipment.toFixed(2)} ×{u.readiness.toFixed(2)} = {strength.toFixed(0)} силы | {u.stance} | {u.daysUntilReady > 0 ? `⏳ ${u.daysUntilReady} дн. до готовности` : "готов"} {u.supplyPenalty < 1 ? ` | снабжение ×${u.supplyPenalty} (отрыв >3)` : ""}</div>
                <div className="gs-faint">содержание {upkeep.toFixed(2)}/день | контролёр {rs?.controllerId} владелец {rs?.ownerId}</div>
                <div className="gs-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  <select value={u.stance} onChange={(e) => handleStance(u.unitId, e.target.value)} aria-label={`Стойка ${u.unitId}`}>
                    <option value="offensive">offensive</option>
                    <option value="defensive">defensive</option>
                    <option value="entrenched">entrenched</option>
                  </select>
                  <input placeholder="toRegionId (напр. GB-2)" value={moveTargets[u.unitId] ?? ""} onChange={(e) => setMoveTargets((m) => ({ ...m, [u.unitId]: e.target.value }))} style={{ width: 150 }} aria-label={`Цель перемещения ${u.unitId}`} />
                  <button className="gs-btn small" onClick={() => handleMove(u.unitId)}>{t["army.move"] ?? "Переместить"}</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="gs-faint" style={{ marginTop: 8 }}>
        Чужие войска в выбранном регионе видны в «Обзоре». Приказы им не отдаются.
        <span style={{ display: "none" }}>{countries.length} стран</span>
      </div>

      {msg ? <div className="gs-card" style={{ marginTop: 8 }}>{msg}</div> : null}
    </div>
  );
}
