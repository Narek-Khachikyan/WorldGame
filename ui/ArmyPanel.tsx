import { useState } from "react";
import { useGameStore } from "./store.js";
import { calculateBaseStrength, dailyUpkeepCost, explainCombat } from "../sim/army.js";
import ru from "./locales/ru.json";

const t = ru as Record<string, string>;

export default function ArmyPanel() {
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const military = sim.getMilitaryLayer();
  const regions = sim.getRegionStates();
  const countries = sim.getScenario().countries;

  const [hireCountry, setHireCountry] = useState<string>("GB");
  const [hireRegion, setHireRegion] = useState<string>("GB-1");
  const [hirePersonnel, setHirePersonnel] = useState<string>("1000");
  const [hireEquipment, setHireEquipment] = useState<string>("0.8");
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>("");

  const handleHire = () => {
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
    const res = dispatch({ type: "moveUnit", payload: { unitId, toRegionId: to } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ ${t["army.moved"] ?? "перемещение"} ${unitId} → ${to}`);
  };

  const handleStance = (unitId: string, stance: string) => {
    const res = dispatch({ type: "setStance", payload: { unitId, stance } });
    if (!res.ok) setMsg(`❌ ${res.reason}`);
    else setMsg(`✓ стойка ${unitId} → ${stance}`);
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t["army.title"] ?? "Армия — группировки"}</h3>
      <p style={{ fontSize: 12, opacity: 0.7 }}>{t["army.hint"] ?? "Найм ограничен населением/оснащением/бюджетом/временем. Перемещение только по соседству или через переправу (остров UK). Бой: сила = состав × оснащение × готовность, оборона +25% + укрепления × местность × снабжение × случайность ±10% (seeded)."}</p>

      {/* hiring */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          {t["army.country"] ?? "Страна"}
          <select value={hireCountry} onChange={(e) => {
            const cc = e.target.value;
            setHireCountry(cc);
            const first = sim.getScenario().regions.find((r) => r.countryId === cc);
            if (first) setHireRegion(first.regionId);
          }}>
            {countries.map((c) => (
              <option key={c.countryId} value={c.countryId}>{c.countryId} {c.nameRu}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          {t["army.region"] ?? "Регион"}
          <select value={hireRegion} onChange={(e) => setHireRegion(e.target.value)}>
            {sim.getScenario().regions.filter((r) => r.countryId === hireCountry).map((r) => (
              <option key={r.regionId} value={r.regionId}>{r.regionId} {r.terrain} {r.isCapitalRegion ? "★" : ""}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          {t["army.personnel"] ?? "Состав"}
          <input value={hirePersonnel} onChange={(e) => setHirePersonnel(e.target.value)} style={{ width: 80 }} placeholder="500-5000" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          {t["army.equipment"] ?? "Оснащение"}
          <input value={hireEquipment} onChange={(e) => setHireEquipment(e.target.value)} style={{ width: 80 }} placeholder="0.5-1.0" />
        </label>
        <button onClick={handleHire}>{t["army.hire"] ?? "Нанять (14 дн.)"}</button>
      </div>

      {/* economy per country */}
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
        {countries.slice(0, 8).map((c) => {
          const eco = sim.getCountryEconomy(c.countryId);
          return <span key={c.countryId} style={{ marginRight: 12 }}>{c.countryId}: казна {eco?.treasury.toFixed(0)} | нас. {eco?.population} | снар. {eco?.equipmentStock}</span>;
        })}
      </div>

      {/* units */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
        {military.units.length === 0 ? (
          <em style={{ fontSize: 13 }}>{t["army.noUnits"] ?? "нет отрядов — наймите первый"}</em>
        ) : (
          military.units.map((u) => {
            const rs = regions.find((r) => r.regionId === u.regionId);
            const strength = calculateBaseStrength(u);
            const upkeep = dailyUpkeepCost(u);
            const supplyPenalty = u.supplyPenalty;
            return (
              <div key={u.unitId} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, fontSize: 13 }}>
                <div><strong>{u.unitId}</strong> {u.countryId} @ {u.regionId} {rs?.isCapitalRegion ? "★ столица" : ""} | {u.personnel} чел. ×{u.equipment.toFixed(2)} ×{u.readiness.toFixed(2)} = {strength.toFixed(0)} силы | {u.stance} | {u.daysUntilReady > 0 ? `⏳ ${u.daysUntilReady} дн. до готовности` : "готов"} {supplyPenalty < 1 ? ` | снабжение ×${supplyPenalty} (отрыв >3)` : ""}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>содержание {upkeep.toFixed(2)}/день (через оборонный вес — хук T4) | {u.supplyBase} | terrain {rs?.terrain} fort {rs?.fortLevel} | контролёр {rs?.controllerId} владелец {rs?.ownerId}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={u.stance} onChange={(e) => handleStance(u.unitId, e.target.value)}>
                    <option value="offensive">offensive</option>
                    <option value="defensive">defensive</option>
                    <option value="entrenched">entrenched</option>
                  </select>
                  <input placeholder="toRegionId (напр. GB-2)" value={moveTargets[u.unitId] ?? ""} onChange={(e) => setMoveTargets((m) => ({ ...m, [u.unitId]: e.target.value }))} style={{ width: 160 }} />
                  <button onClick={() => handleMove(u.unitId)}>{t["army.move"] ?? "Переместить"}</button>
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{t["army.formula"] ?? "сила = состав × оснащение × готовность; оборона ×1.25 × укрепления × местность × снабжение × ±10% RNG"}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* military map layer hint */}
      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        <strong>{t["army.mapLayer"] ?? "Военный слой карты"}:</strong> {t["army.mapHint"] ?? "показывается контролёр vs владелец (захват = смена контролёра, владелец только миром T6), снабжение дальше 3 регионов — штраф 0.7 (Stage B — полная сеть)."} 
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {regions.slice(0, 8).map((r) => (
            <span key={r.regionId} style={{ fontSize: 10, border: "1px solid #eee", padding: "2px 4px", borderRadius: 4 }}>{r.regionId}: {r.controllerId}/{r.ownerId} {r.terrain}{r.fortLevel ? `+укр${r.fortLevel}` : ""} {r.isCapitalRegion ? "★" : ""}</span>
          ))}
        </div>
      </div>

      {msg ? <div style={{ marginTop: 8, fontSize: 13, border: "1px solid #ddd", padding: 6, borderRadius: 4, background: "#fafafa" }}>{msg}</div> : null}
    </div>
  );
}
