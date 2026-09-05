import { useGameStore } from "../store.js";
import ru from "../locales/ru.json";

export default function TopBar() {
  const sim = useGameStore((s) => s.sim);
  const lastDate = useGameStore((s) => s.lastDate);
  // T6 wars: derive from sim snapshot; re-renders on lastDate change (tick/dispatch bumps it)
  const activeWars = sim.getWarsSnapshot().filter((w) => w.status === "active");
  const wars = activeWars.map((w) => ({ id: w.warId }));
  // constructions placeholder: count active projects across economies
  const snap = sim.getSnapshot();
  const constructions = snap.projects?.filter((p) => p.status === "active") ?? [];
  // treasury/balance placeholder — show player country if available, else GB
  const playerCountryId = useGameStore((s) => s.playerCountryId);
  const selectedCountryId = useGameStore((s) => s.selectedCountryId);
  const ecoCountry = playerCountryId ?? selectedCountryId ?? "GB";
  const eco = snap.economies?.[ecoCountry];
  const treasury = eco?.treasury ?? null;
  const balance = eco ? eco.lastIncome - eco.lastExpense : null;
  const speed = useGameStore((s) => s.speed);
  const isPaused = useGameStore((s) => s.isPaused);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);
  // need wars etc from store — for T3 they are zero, T4/T5/T6 will extend useTopbarStubs
  // Show placeholder values
  const t = ru as Record<string, string>;

  return (
    <div
      data-testid="topbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        border: "1px solid #d1d5db",
        background: "#ffffff",
        padding: "10px 14px",
        borderRadius: 10,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* date */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t["topbar.date"] ?? "Дата"}
        </span>
        <strong style={{ fontSize: 15 }}>{lastDate}</strong>
      </div>

      <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

      {/* treasury placeholder */}
      <div title={t["topbar.treasury.hint"] ?? "Экономика появится в T4"} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t["topbar.treasury"] ?? "Казна"}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: treasury === null ? "#9ca3af" : "#111827" }}>
          {treasury === null ? "—" : `${treasury.toLocaleString("ru-RU")} ₵`}
        </span>
        {treasury === null && (
          <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "2px 6px", borderRadius: 6 }}>
            T4
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={t["topbar.balance.hint"] ?? "Баланс появится в T4"}>
        <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t["topbar.balance"] ?? "Баланс"}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: balance === null ? "#9ca3af" : balance >= 0 ? "#065f46" : "#991b1b" }}>
          {balance === null ? "—" : `${balance > 0 ? "+" : ""}${balance.toLocaleString("ru-RU")}/мес`}
        </span>
      </div>

      <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

      {/* speeds */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={togglePause}
          data-testid="btn-pause"
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: isPaused ? "1px solid #f59e0b" : "1px solid #d1d5db",
            background: isPaused ? "#fef3c7" : "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
          title={isPaused ? "Продолжить (пробел)" : "Пауза (пробел)"}
        >
          {isPaused ? "▶ Продолжить" : t["controls.pause"] ?? "Пауза"}
        </button>
        {(["slow", "normal", "fast"] as const).map((sp) => {
          const label =
            sp === "slow"
              ? t["controls.slow"] ?? "Медленно"
              : sp === "normal"
                ? t["controls.normal"] ?? "Нормально"
                : t["controls.fast"] ?? "Быстро";
          const isActive = speed === sp && !isPaused;
          const dps = { slow: 1, normal: 3, fast: 7 }[sp];
          return (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              data-testid={`btn-${sp}`}
              disabled={isActive}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: isActive ? "1px solid #111827" : "1px solid #d1d5db",
                background: isActive ? "#111827" : "#fff",
                color: isActive ? "#fff" : "#111827",
                opacity: isActive ? 1 : 0.92,
                cursor: isActive ? "default" : "pointer",
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
              }}
              title={`${label} — ${dps} дн/сек, календарь не зависит от FPS`}
            >
              {label.split(" ")[0]} · {dps} дн/сек
            </button>
          );
        })}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* wars */}
        <div
          data-testid="wars-indicator"
          title={wars.length === 0 ? t["topbar.wars.emptyHint"] ?? "Нет активных войн. Объявление войны появится в T6." : "Активные войны"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: wars.length ? "#fef2f2" : "#f9fafb",
            border: `1px solid ${wars.length ? "#fecaca" : "#e5e7eb"}`,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <span style={{ fontSize: 12, color: "#6b7280" }}>{t["topbar.wars"] ?? "Войны"}:</span>
          <strong style={{ color: wars.length ? "#991b1b" : "#6b7280" }}>{wars.length}</strong>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{wars.length === 0 ? "— нет" : ""}</span>
        </div>

        {/* constructions */}
        <div
          data-testid="constructions-indicator"
          title={constructions.length === 0 ? t["topbar.constructions.emptyHint"] ?? "Нет активных строек. Экономика появится в T4." : "Активные стройки"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: constructions.length ? "#eff6ff" : "#f9fafb",
            border: `1px solid ${constructions.length ? "#bfdbfe" : "#e5e7eb"}`,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <span style={{ fontSize: 12, color: "#6b7280" }}>{t["topbar.constructions"] ?? "Стройки"}:</span>
          <strong style={{ color: constructions.length ? "#1d4ed8" : "#6b7280" }}>{constructions.length}</strong>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{constructions.length === 0 ? "— нет" : ""}</span>
        </div>

        <div style={{ fontSize: 11, color: "#9ca3af", maxWidth: 140, lineHeight: 1.2 }}>
          seed {sim.getSeed()} · {sim.getDaysElapsed()} дн. · тиков {sim.getTickCount()}
        </div>
      </div>
    </div>
  );
}
