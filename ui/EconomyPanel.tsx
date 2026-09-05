/**
 * EconomyPanel — minimal React panel for T4 economy end-to-end.
 *
 * Panel mount contract (for UI T3 #4 merger):
 * ------------------------------------------------
 * Props: { sim: SimEngine, countryId: string, onCommand?: (res: ValidationResult)=>void }
 * - Queries used (read-only, pure):
 *   sim.getEconomy(countryId)             -> CountryEconomy
 *   sim.forecastProject(countryId, regionId, type) -> EconomyForecast (pure, no mutation)
 *   sim.forecastTax(countryId, newTax)    -> TaxForecast
 *   sim.forecastWeights(countryId, newWeights) -> WeightsForecast
 *   sim.getProjects(countryId)            -> Project[]
 *   sim.getCountryIds()                   -> string[]
 *   sim.getRegionController(regionId)     -> string
 *   sim.getEventLogTail(n)                -> для "что изменилось и почему" (taxChanged/weightsChanged/projectStarted/completed/monthlyTick)
 * - Commands dispatched (via validator whitelist + eventLog reasons):
 *   sim.dispatch({ type: "setTax", payload: { countryId, taxRate } })
 *   sim.dispatch({ type: "setWeights", payload: { countryId, weights: {defense,infra,social,edu} } })
 *   sim.dispatch({ type: "startProject", payload: { countryId, regionId, projectType } })
 *   sim.dispatch({ type: "setRegionController", payload: { regionId, newControllerId } }) — for war/occupation (loss test)
 * - Panel is pure view over sim; sim is source of truth, panel never mutates state directly.
 * - Mount point in App: <EconomyPanel sim={sim} countryId={selectedCountryId} />
 *   where selectedCountryId comes from zustand store (default GB for now, until map selection T3).
 * - Monthly tick is inside SimEngine.tick(days) (aggregate daily→monthly), panel just re-renders on sim date change.
 * - Russian texts via ui/locales/ru.json keys economy.*.
 * ------------------------------------------------
 * Primary is sim+panel logic; UI may be minimal but must show forecast before confirm.
 */

import { useState, useMemo } from "react";
import type { SimEngine } from "../sim/engine.js";
import type { ProjectType, ExpenseWeights } from "../sim/economy.js";
import { ECONOMY_RULES } from "../sim/economy.js";

interface Props {
  sim: SimEngine;
  countryId: string;
}

const PROJECT_TYPES: ProjectType[] = ["industrialComplex", "powerUnit", "regionInfra"];

export default function EconomyPanel({ sim, countryId }: Props) {
  const eco = sim.getEconomy(countryId);
  const [taxDraft, setTaxDraft] = useState<number | null>(null);
  const [weightsDraft, setWeightsDraft] = useState<ExpenseWeights | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>(() => {
    const e = sim.getEconomy(countryId);
    // first controlled region or first known
    if (e && e.controlledRegions.size > 0) return Array.from(e.controlledRegions)[0];
    return `${countryId}-1`;
  });
  const [selectedType, setSelectedType] = useState<ProjectType>("industrialComplex");

  if (!eco) return <div>Неизвестная страна {countryId}</div>;

  const taxValue = taxDraft ?? eco.taxRate;
  const weightsValue = weightsDraft ?? eco.weights;

  const taxForecast = useMemo(() => {
    if (taxDraft === null || taxDraft === eco.taxRate) return null;
    return sim.forecastTax(countryId, taxDraft);
  }, [sim, countryId, taxDraft, eco.taxRate]);

  const weightsForecast = useMemo(() => {
    if (!weightsDraft) return null;
    // shallow compare
    const same =
      weightsDraft.defense === eco.weights.defense &&
      weightsDraft.infra === eco.weights.infra &&
      weightsDraft.social === eco.weights.social &&
      weightsDraft.edu === eco.weights.edu;
    if (same) return null;
    return sim.forecastWeights(countryId, weightsDraft);
  }, [sim, countryId, weightsDraft, eco.weights]);

  const projectForecast = useMemo(() => {
    return sim.forecastProject(countryId, selectedRegion, selectedType);
  }, [sim, countryId, selectedRegion, selectedType, eco.activeProjects.length, eco.completedProjects.length, eco.treasury, eco.controlledRegions.size]);

  const eventsWhy = sim.getEventLogTail(20).filter((e) => ["taxChanged", "weightsChanged", "projectStarted", "projectCompleted", "monthlyTick", "regionControllerChanged"].includes(e.kind)).slice(-5).reverse();

  const balance = eco.lastIncome - eco.lastExpense;

  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, fontSize: 13 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>Экономика — {countryId}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div><strong>Казна:</strong> {eco.treasury.toFixed(2)} {eco.debt > 0 ? <span style={{ color: "crimson" }}>(долг {eco.debt.toFixed(2)})</span> : null}</div>
        <div><strong>ВВП (мес.):</strong> {eco.gdp.toFixed(2)} <span style={{ opacity: 0.6, fontSize: 11 }}>(не кошелёк)</span></div>
        <div><strong>Доход:</strong> {eco.lastIncome.toFixed(2)}</div>
        <div><strong>Расход:</strong> {eco.lastExpense.toFixed(2)} <span style={{ opacity: 0.6 }}>(проценты {eco.lastInterest.toFixed(2)})</span></div>
        <div><strong>Баланс:</strong> <span style={{ color: balance >= 0 ? "green" : "crimson" }}>{balance.toFixed(2)}</span></div>
        <div><strong>Рост:</strong> {(eco.lastGrowthRate * 100).toFixed(2)}% /мес.</div>
        <div><strong>Поддержка:</strong> {eco.lastSupport.toFixed(1)}</div>
        <div style={{ fontSize: 11, opacity: 0.7, gridColumn: "1 / -1" }}>ВВП — не кошелёк; казна меняется только через доход/расход/долг. Потеря промрегиона бьёт по доходу.</div>
      </div>

      {/* Налог */}
      <div style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Налог</strong>
          <span>{(taxValue * 100).toFixed(0)}%</span>
        </div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>Доход сейчас vs рост/поддержка потом</div>
        <input
          type="range"
          min={ECONOMY_RULES.income.tax.min}
          max={ECONOMY_RULES.income.tax.max}
          step={ECONOMY_RULES.income.tax.step}
          value={taxValue}
          onChange={(e) => setTaxDraft(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        {taxForecast ? (
          <div style={{ background: "#f7f7ff", border: "1px solid #ddd", borderRadius: 6, padding: 6, marginTop: 4 }}>
            <div style={{ fontWeight: 600 }}>Прогноз до подтверждения:</div>
            <div>Доход {taxForecast.currentIncome.toFixed(2)} → {taxForecast.forecastIncome.toFixed(2)} ({taxForecast.incomeDelta >= 0 ? "+" : ""}{taxForecast.incomeDelta.toFixed(2)})</div>
            <div>Рост {(taxForecast.currentGrowthRate * 100).toFixed(2)}% → {(taxForecast.forecastGrowthRate * 100).toFixed(2)}%</div>
            <div>Поддержка {taxForecast.currentSupport.toFixed(1)} → {taxForecast.forecastSupport.toFixed(1)}</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{taxForecast.reason}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => { sim.dispatch({ type: "setTax", payload: { countryId, taxRate: taxValue } }); setTaxDraft(null); }}>Подтвердить</button>
              <button onClick={() => setTaxDraft(null)}>Отмена</button>
            </div>
          </div>
        ) : (
          taxDraft !== null && taxDraft !== eco.taxRate ? (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={() => { sim.dispatch({ type: "setTax", payload: { countryId, taxRate: taxValue } }); setTaxDraft(null); }}>Подтвердить</button>
              <button onClick={() => setTaxDraft(null)}>Отмена</button>
            </div>
          ) : null
        )}
      </div>

      {/* Веса */}
      <div style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
        <strong>Веса расходов</strong>
        <div style={{ fontSize: 11, opacity: 0.7 }}>Оборона / Инфра / Соц / Наука (лаг ~6 мес.)</div>
        {(["defense", "infra", "social", "edu"] as const).map((cat) => {
          const label = cat === "defense" ? "Оборона" : cat === "infra" ? "Инфраструктура" : cat === "social" ? "Соцсфера" : "Наука";
          return (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ width: 110 }}>{label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weightsValue[cat]}
                onChange={(e) => setWeightsDraft({ ...weightsValue, [cat]: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span style={{ width: 30 }}>{(weightsValue[cat] * 100).toFixed(0)}%</span>
            </div>
          );
        })}
        {weightsForecast ? (
          <div style={{ background: "#fff7e6", border: "1px solid #ddd", borderRadius: 6, padding: 6, marginTop: 6 }}>
            <div style={{ fontWeight: 600 }}>Прогноз до подтверждения:</div>
            <div>Расход {weightsForecast.currentExpense.toFixed(2)} → {weightsForecast.forecastExpense.toFixed(2)} ({weightsForecast.expenseDelta >= 0 ? "+" : ""}{weightsForecast.expenseDelta.toFixed(2)})</div>
            <div>Рост {(weightsForecast.currentGrowthRate * 100).toFixed(2)}% → {(weightsForecast.forecastGrowthRate * 100).toFixed(2)}%</div>
            <div>Поддержка {weightsForecast.currentSupport.toFixed(1)} → {weightsForecast.forecastSupport.toFixed(1)}</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{weightsForecast.reason}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => { sim.dispatch({ type: "setWeights", payload: { countryId, weights: weightsValue } }); setWeightsDraft(null); }}>Подтвердить</button>
              <button onClick={() => setWeightsDraft(null)}>Отмена</button>
            </div>
          </div>
        ) : weightsDraft ? (
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={() => { sim.dispatch({ type: "setWeights", payload: { countryId, weights: weightsValue } }); setWeightsDraft(null); }}>Подтвердить</button>
            <button onClick={() => setWeightsDraft(null)}>Отмена</button>
          </div>
        ) : null}
      </div>

      {/* Стройки */}
      <div style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
        <strong>Стройки (3 типа, слоты на регион — {ECONOMY_RULES.projects.industrialComplex.slotLimitPerRegion})</strong>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)} style={{ flex: 1, minWidth: 120 }}>
            {Array.from(eco.controlledRegions).sort().map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            {/* also show uncontrolled to demonstrate unavailableReason */}
            {["GB-1","GB-2","GB-3","GB-4","FR-1","DE-1","PL-1"].filter((r)=>!eco.controlledRegions.has(r)).slice(0,2).map((r)=>(
              <option key={r} value={r}>{r} (чужой)</option>
            ))}
          </select>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value as ProjectType)} style={{ flex: 1 }}>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>{ECONOMY_RULES.projects[t].nameRu} — {ECONOMY_RULES.projects[t].price}₥, {ECONOMY_RULES.projects[t].durationDays}дн.</option>
            ))}
          </select>
        </div>

        {projectForecast ? (
          <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 6, marginTop: 6, background: projectForecast.unavailableReason ? "#ffe6e6" : "#e6ffe6" }}>
            <div style={{ fontWeight: 600 }}>Прогноз до подтверждения:</div>
            <div>Стоимость: {projectForecast.cost}₥, срок: {projectForecast.durationDays} дн., слоты: {eco.activeProjects.filter((p)=>p.regionId===selectedRegion).length + eco.completedProjects.filter((p)=>p.regionId===selectedRegion).length}/{projectForecast.slotLimitPerRegion} занято</div>
            <div>Доход {projectForecast.currentIncome.toFixed(2)} → {projectForecast.forecastIncome.toFixed(2)} ({projectForecast.incomeDelta >= 0 ? "+" : ""}{projectForecast.incomeDelta.toFixed(2)})</div>
            <div>Выгоды: {projectForecast.benefits.join("; ")}</div>
            <div>Риски: {projectForecast.risks.join("; ")}</div>
            {projectForecast.unavailableReason ? (
              <div style={{ color: "crimson", marginTop: 4 }}><strong>Недоступно:</strong> {projectForecast.unavailableReason}</div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={() => {
                    const res = sim.dispatch({ type: "startProject", payload: { countryId, regionId: selectedRegion, projectType: selectedType } });
                    console.log("startProject", res);
                  }}
                  disabled={!!projectForecast.unavailableReason}
                >
                  Начать стройку
                </button>
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Казна после списания: {projectForecast.treasuryAfterCost.toFixed(2)} {projectForecast.debtAfterCost>0?`(долг ${projectForecast.debtAfterCost.toFixed(2)})`:""}</div>
          </div>
        ) : null}

        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Активные / завершённые:</div>
          {eco.activeProjects.length === 0 && eco.completedProjects.length === 0 ? (
            <em style={{ fontSize: 12, opacity: 0.7 }}>Нет строек</em>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {eco.activeProjects.map((p) => (
                <div key={p.id} style={{ border: "1px solid #eee", padding: 4, borderRadius: 4, fontSize: 12 }}>
                  <strong>{ECONOMY_RULES.projects[p.type as ProjectType]?.nameRu ?? p.type}</strong> в {p.regionId} — активен до {p.endDate} (осталось {p.endDay - sim.getDaysElapsed()} дн.)
                </div>
              ))}
              {eco.completedProjects.map((p) => (
                <div key={p.id} style={{ border: "1px solid #d6ffd6", padding: 4, borderRadius: 4, fontSize: 12, background: "#f0fff0" }}>
                  <strong>{ECONOMY_RULES.projects[p.type as ProjectType]?.nameRu ?? p.type}</strong> в {p.regionId} — завершён {p.endDate}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Что изменилось и почему */}
      <div style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
        <strong>Что изменилось и почему</strong>
        <div style={{ fontSize: 11, opacity: 0.7 }}>Последние эконом-события с причинами</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
          {eventsWhy.length === 0 ? <em style={{ fontSize: 11, opacity: 0.6 }}>Пока нет изменений</em> : eventsWhy.map((e) => (
            <div key={e.id} style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 4 }}>
              <div style={{ fontSize: 10, opacity: 0.6 }}>{e.date} · {e.kind}</div>
              <div style={{ fontSize: 12 }}>{e.message ?? JSON.stringify(e.payload)}</div>
            </div>
          ))}
        </div>
        {eco.lastChangeReason ? (
          <div style={{ marginTop: 6, fontSize: 11, background: "#f0f0ff", border: "1px solid #ddd", borderRadius: 4, padding: 4 }}>
            Последнее изменение: {eco.lastChangeReason}
          </div>
        ) : null}
      </div>
    </div>
  );
}
