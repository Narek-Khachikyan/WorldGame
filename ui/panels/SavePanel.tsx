import { useState, useRef } from "react";
import { useGameStore } from "../store.js";
import { saveGame, loadGame, SAVE_VERSION, SAVE_SLOTS } from "../../sim/save.js";

export default function SavePanel() {
  const sim = useGameStore((s) => s.sim);
  const loadSim = useGameStore((s) => s.loadSim);
  const lastDate = useGameStore((s) => s.lastDate);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSaveSlot = (slotIdx: number) => {
    try {
      const save = saveGame(sim);
      const key = `wb-save-slot-${slotIdx}`;
      const json = JSON.stringify(save);
      localStorage.setItem(key, json);
      setMsg(`✓ сохранено в слот ${slotIdx} (${save.date}, тиков ${save.tickCount})`);
      setErr("");
    } catch (e) {
      setErr(`Ошибка сохранения: ${(e as Error).message}`);
    }
  };

  const handleLoadSlot = (slotIdx: number) => {
    try {
      const key = `wb-save-slot-${slotIdx}`;
      const json = localStorage.getItem(key);
      if (!json) {
        setErr(`Слот ${slotIdx} пуст / Slot ${slotIdx} empty`);
        setMsg("");
        return;
      }
      const res = loadGame(json);
      if (!res.ok) {
        setErr(res.error);
        setMsg("");
        return;
      }
      loadSim(res.sim);
      setMsg(`✓ загружено из слота ${slotIdx} (${res.sim.getDate()})`);
      setErr("");
    } catch (e) {
      setErr(`Сейв повреждён: ${(e as Error).message} / Save corrupted`);
    }
  };

  const handleExport = () => {
    try {
      const save = saveGame(sim);
      const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worldbalance-save-${sim.getDate()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(`✓ экспорт файла worldbalance-save-${sim.getDate()}.json`);
      setErr("");
    } catch (e) {
      setErr(`Ошибка экспорта: ${(e as Error).message}`);
    }
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const res = loadGame(text);
      if (!res.ok) {
        setErr(res.error);
        setMsg("");
        return;
      }
      loadSim(res.sim);
      setMsg(`✓ импорт файла загружен (${res.sim.getDate()}, seed ${res.sim.getSeed()})`);
      setErr("");
    };
    reader.onerror = () => setErr("Ошибка чтения файла / File read error");
    reader.readAsText(file);
  };

  const slotInfos = [1, 2, 3].map((idx) => {
    let info: string | null = null;
    try {
      const json = typeof localStorage !== "undefined" ? localStorage.getItem(`wb-save-slot-${idx}`) : null;
      if (json) {
        const parsed = JSON.parse(json);
        info = `${parsed.date ?? "?"} · ${parsed.seed ?? "?"} · ${parsed.tickCount ?? "?"} тиков`;
      }
    } catch {}
    return { idx, info };
  });

  return (
    <div data-testid="save-panel" style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: "#fff" }}>
      <h3 style={{ marginTop: 0 }}>Сохранения</h3>
      <p style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.35 }}>
        JSON v{SAVE_VERSION}: version/seed/дата/страны/регионы/армии/выборы/хвост лога (100). Валидация при загрузке — битый/несовместимый сейв = понятная ошибка без краша. Локальные слоты + экспорт/импорт файла.
      </p>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
        Текущий: <strong>{sim.getDate()}</strong> · seed {sim.getSeed()} · дней {sim.getDaysElapsed()} · тиков {sim.getTickCount()} · слоты {SAVE_SLOTS.join(", ")}
      </div>

      {/* slots */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {[1, 2, 3].map((idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", border: "1px solid #eee", borderRadius: 6, padding: 6, background: "#f9fafb" }}>
            <span style={{ minWidth: 56, fontSize: 12, fontWeight: 700 }}>Слот {idx}</span>
            <span style={{ flex: 1, fontSize: 11, opacity: 0.7 }}>{slotInfos[idx - 1].info ?? "— пусто —"}</span>
            <button onClick={() => handleSaveSlot(idx)} data-testid={`btn-save-slot-${idx}`} style={{ padding: "4px 8px", fontSize: 12 }}>
              Сохранить
            </button>
            <button onClick={() => handleLoadSlot(idx)} data-testid={`btn-load-slot-${idx}`} style={{ padding: "4px 8px", fontSize: 12 }}>
              Загрузить
            </button>
          </div>
        ))}
      </div>

      {/* export/import */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <button onClick={handleExport} data-testid="btn-export-save" style={{ padding: "6px 10px", fontSize: 12 }}>
          Экспорт файла
        </button>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          Импорт файла
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            data-testid="input-import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              // reset so same file can be re-selected
              if (fileRef.current) fileRef.current.value = "";
            }}
            style={{ fontSize: 11 }}
          />
        </label>
        <button
          data-testid="btn-import-save"
          style={{ display: "none" }}
          onClick={() => fileRef.current?.click()}
        >
          hidden import
        </button>
      </div>

      {msg ? <div data-testid="save-msg" style={{ fontSize: 12, border: "1px solid #bbf7d0", background: "#f0fdf4", padding: 6, borderRadius: 4, marginBottom: 6 }}>{msg}</div> : null}
      {err ? <div data-testid="save-error" style={{ fontSize: 12, border: "1px solid #fecaca", background: "#fef2f2", padding: 6, borderRadius: 4, color: "#991b1b", whiteSpace: "pre-wrap" }}>{err}</div> : null}

      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6, lineHeight: 1.3 }}>
        Проверка: битый JSON или несовместимая версия (≠{SAVE_VERSION}) даёт понятную ошибку без краша. Состояние сохраняется полностью — повторная загрузка детерминирована.
      </div>
    </div>
  );
}
