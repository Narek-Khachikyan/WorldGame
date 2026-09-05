import { useEffect, useRef } from "react";
import { useGameStore } from "../store.js";
import ru from "../locales/ru.json";

export default function EventLog() {
  const t = ru as Record<string, string>;
  const sim = useGameStore((s) => s.sim);
  const lastDate = useGameStore((s) => s.lastDate);
  // pull tail reactively on each date tick (sim log grows)
  // use a version counter tied to lastDate to refresh
  const events = sim.getEventLogTail(30);

  const scrollRef = useRef<HTMLDivElement>(null);

  // auto-scroll to bottom when new events arrive? For T3 keep reverse chronological (newest top) so no auto scroll needed.
  useEffect(() => {
    // if we wanted auto-scroll, do here
  }, [lastDate, events.length]);

  return (
    <div
      data-testid="event-log"
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
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid #e5e7eb",
          background: "#f9fafb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <strong style={{ fontSize: 13 }}>{t["eventLog.title"] ?? "Журнал событий"}</strong>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{events.length ? `${events.length} показать` : ""}</span>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 12,
          lineHeight: 1.4,
          minHeight: 180,
          maxHeight: 360,
        }}
      >
        {events.length === 0 ? (
          <em style={{ color: "#9ca3af" }}>{t["eventLog.empty"] ?? "Пока пусто — события появятся при тиках и командах"}</em>
        ) : (
          [...events].reverse().map((e) => {
            const isRejected = e.kind === "commandRejected";
            const isAttention = e.kind === "dayTick" ? false : true;
            return (
              <div
                key={e.id}
                style={{
                  border: `1px solid ${isRejected ? "#fecaca" : isAttention ? "#e5e7eb" : "#f3f4f6"}`,
                  background: isRejected ? "#fef2f2" : isAttention ? "#fff" : "#f9fafb",
                  borderRadius: 8,
                  padding: "6px 8px",
                }}
              >
                <div style={{ fontSize: 10, color: "#6b7280", display: "flex", gap: 6 }}>
                  <span>#{e.id}</span>
                  <span>{e.date}</span>
                  <span
                    style={{
                      background: isRejected ? "#fee2e2" : "#f3f4f6",
                      padding: "0 4px",
                      borderRadius: 4,
                      fontFamily: "monospace",
                    }}
                  >
                    {e.kind}
                  </span>
                </div>
                <div style={{ marginTop: 4, color: "#111827" }}>{e.message ?? (e.payload ? JSON.stringify(e.payload) : "")}</div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: "6px 10px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", fontSize: 11, color: "#6b7280" }}>
        {t["eventLog.hint"] ?? "События приходят напрямую из сима (sim/eventLog) — журнал живой, обновляется каждый тик."}
      </div>
    </div>
  );
}
