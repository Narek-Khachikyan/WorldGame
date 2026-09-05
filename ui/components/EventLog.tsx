import { useGameStore } from "../store.js";

export default function EventLog({ compact }: { compact?: boolean }) {
  const sim = useGameStore((s) => s.sim);
  useGameStore((s) => s.lastDate);
  // Подписка на ревизию: журнал обновляется сразу после команд, даже если дата не изменилась.
  useGameStore((s) => s.stateRev);
  // Без спама: ежедневные dayTick/simCreated/upkeepDeducted скрываем, показываем решения и итоги.
  const events = sim.getEventLogTail(80).filter((e) => e.kind !== "dayTick" && e.kind !== "simCreated" && e.kind !== "upkeepDeducted").slice(-(compact ? 12 : 30));

  return (
    <div data-testid="event-log" className="gs-float gs-eventlog" role="log" aria-label="Журнал событий">
      <div className="gs-row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: 12 }}>Журнал событий</strong>
        <span className="gs-faint">{events.length ? `${events.length}` : ""}</span>
      </div>
      <div className="gs-loglist">
        {events.length === 0 ? (
          <em className="gs-faint">Пока пусто — события появятся при тиках и командах</em>
        ) : (
          [...events].reverse().map((e) => {
            const isRejected = e.kind === "commandRejected";
            return (
              <div key={e.id} className={`gs-logitem ${isRejected ? "rejected" : ""}`}>
                <div className="meta">
                  <span>#{e.id}</span>
                  <span>{e.date}</span>
                  <span>{e.kind}</span>
                </div>
                <div style={{ marginTop: 3 }}>{e.message ?? (e.payload ? JSON.stringify(e.payload) : "")}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
