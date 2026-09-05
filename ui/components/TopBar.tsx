import { useGameStore } from "../store.js";

export default function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const sim = useGameStore((s) => s.sim);
  const lastDate = useGameStore((s) => s.lastDate);
  // Re-render on every command, even when the date is unchanged (paused commands).
  useGameStore((s) => s.stateRev);
  const playerCountryId = useGameStore((s) => s.playerCountryId);
  const hasStarted = useGameStore((s) => s.hasStarted);
  const scenario = useGameStore((s) => s.scenario);
  const speed = useGameStore((s) => s.speed);
  const isPaused = useGameStore((s) => s.isPaused);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);
  const isDevMode = useGameStore((s) => s.isDevMode);
  const toggleDevMode = useGameStore((s) => s.toggleDevMode);

  const snap = sim.getSnapshot();
  const ecoCountry = playerCountryId ?? null;
  const eco = ecoCountry ? snap.economies?.[ecoCountry] : undefined;
  const treasury = eco ? (eco as { treasury: number }).treasury : null;
  const balance = eco ? (eco as { lastIncome: number; lastExpense: number }).lastIncome - (eco as { lastIncome: number; lastExpense: number }).lastExpense : null;

  let stability: number | null = null;
  if (ecoCountry) {
    try {
      stability = sim.getPoliticalState(ecoCountry)?.stability ?? null;
    } catch {
      stability = null;
    }
  }

  const allWars = sim.getWarsSnapshot().filter((w) => w.status === "active");
  const myWars = playerCountryId ? allWars.filter((w) => w.attackerId === playerCountryId || w.defenderId === playerCountryId) : [];
  const constructions = snap.projects?.filter((p) => p.status === "active") ?? [];
  const myConstructions = playerCountryId ? constructions.filter((p) => p.countryId === playerCountryId) : constructions;

  const playerName = playerCountryId ? scenario.countries.find((c) => c.countryId === playerCountryId)?.nameRu ?? playerCountryId : "—";

  return (
    <header data-testid="topbar" className="gs-topbar" aria-label="Верхняя панель состояния">
      <div className="gs-brand">
        World Balance
        <small>Европа-16 · срез A</small>
      </div>

      <div className="gs-sep" aria-hidden="true" />

      {/* Постоянная сводка своей страны — никогда не подменяется выбором на карте */}
      <div className="gs-stat" title={hasStarted ? "Ваша страна — показатели всегда ваши, выбор на карте их не меняет" : "Страна будет выбрана на старте"}>
        <span className="k">Страна</span>
        <span className="v" data-testid="topbar-player">{hasStarted ? `${playerCountryId} · ${playerName}` : "—"}</span>
      </div>

      <div className="gs-stat" title="Казна вашей страны">
        <span className="k">Казна</span>
        <span className="v brass" data-testid="topbar-treasury">
          {treasury === null ? "—" : `${Math.round(treasury).toLocaleString("ru-RU")} ₵`}
        </span>
      </div>

      <div className="gs-stat" title="Доход минус расход за последний месяц (ваша страна)">
        <span className="k">Баланс/мес</span>
        <span className={`v ${balance === null ? "" : balance >= 0 ? "pos" : "neg"}`}>
          {balance === null ? "—" : `${balance > 0 ? "+" : ""}${Math.round(balance).toLocaleString("ru-RU")}`}
        </span>
      </div>

      {stability !== null && (
        <div className="gs-stat" title="Стабильность вашей страны">
          <span className="k">Стабильность</span>
          <span className="v">{stability.toFixed(1)}</span>
        </div>
      )}

      <div className="gs-sep" aria-hidden="true" />

      <div className="gs-stat" title="Игровая дата">
        <span className="k">Дата</span>
        <span className="v gs-date">{lastDate}</span>
      </div>

      <div className="gs-time-controls" role="group" aria-label="Управление временем">
        <button onClick={togglePause} data-testid="btn-pause" className="gs-btn" title={isPaused ? "Продолжить (Space)" : "Пауза (Space)"} aria-pressed={isPaused}>
          {isPaused ? "▶" : "❚❚"}
        </button>
        {(["slow", "normal", "fast"] as const).map((sp) => {
          const label = sp === "slow" ? "I" : sp === "normal" ? "II" : "III";
          const dps = { slow: 1, normal: 3, fast: 7 }[sp];
          const isActive = speed === sp && !isPaused;
          return (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              data-testid={`btn-${sp}`}
              className="gs-btn"
              aria-pressed={isActive}
              title={`${sp === "slow" ? "Медленно" : sp === "normal" ? "Нормально" : "Быстро"} — ${dps} дн/сек`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="gs-spacer">
        <div data-testid="wars-indicator" className={`gs-chip ${myWars.length ? "alert" : ""}`} title={myWars.length === 0 ? "У вашей страны нет активных войн" : `Ваши войны: ${myWars.map((w) => `${w.attackerId}→${w.defenderId}`).join(", ")}`}>
          <span className="k">Ваши войны</span>
          <strong>{myWars.length}</strong>
        </div>
        <div data-testid="world-wars-indicator" className="gs-chip" title={`Войны в мире: ${allWars.length}`}>
          <span className="k">В мире</span>
          <strong>{allWars.length}</strong>
        </div>
        <div data-testid="constructions-indicator" className={`gs-chip ${myConstructions.length ? "good" : ""}`} title={myConstructions.length === 0 ? "У вашей страны нет активных строек" : "Активные стройки вашей страны"}>
          <span className="k">Стройки</span>
          <strong>{myConstructions.length}</strong>
        </div>
        {isDevMode && (
          <div className="gs-chip" title="Технические данные (dev-режим)">
            <span className="k">seed {sim.getSeed()} · {sim.getDaysElapsed()} дн · tick {sim.getTickCount()}</span>
          </div>
        )}
        <button onClick={toggleDevMode} className="gs-btn small ghost" title={isDevMode ? "Выключить developer-режим" : "Включить developer-режим (seed, тики, техпанели)"} aria-pressed={isDevMode} data-testid="btn-devmode">
          DEV
        </button>
        <button onClick={onOpenMenu} className="gs-btn" data-testid="btn-menu" aria-haspopup="dialog">
          ☰ Меню
        </button>
      </div>
    </header>
  );
}
