import type { GameSection } from "../store.js";

const ITEMS: Array<{ id: GameSection; label: string; icon: string; hint: string }> = [
  { id: "overview", label: "Обзор", icon: "ОБ", hint: "Контекст выбранной страны и региона" },
  { id: "economy", label: "Экономика", icon: "ЭК", hint: "Казна, налог, веса, стройки вашей страны" },
  { id: "army", label: "Армия", icon: "АР", hint: "Найм, перемещение, состав ваших войск" },
  { id: "politics", label: "Политика", icon: "ПО", hint: "Режим, лидер, выборы вашей страны" },
  { id: "diplomacy", label: "Дипломатия", icon: "ДИ", hint: "Война и мир" },
];

export default function GameNav({
  active,
  onChange,
  onToggleLog,
  logOpen,
  onToggleSide,
  sideOpen,
}: {
  active: GameSection;
  onChange: (s: GameSection) => void;
  onToggleLog: () => void;
  logOpen: boolean;
  onToggleSide: () => void;
  sideOpen: boolean;
}) {
  return (
    <nav className="gs-nav" aria-label="Разделы управления">
      <div className="gs-nav-title">Управление</div>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className="gs-nav-btn"
          aria-current={active === it.id}
          title={it.hint}
          data-testid={`nav-${it.id}`}
          onClick={() => onChange(it.id)}
        >
          <i className="ico" aria-hidden="true">{it.icon}</i>
          <span className="lbl">{it.label}</span>
        </button>
      ))}
      <div className="gs-nav-foot">
        <button className="gs-nav-btn" onClick={onToggleLog} aria-pressed={logOpen} title="Показать/скрыть журнал событий" data-testid="nav-log">
          <i className="ico" aria-hidden="true" style={{ fontSize: 10 }}>ЖУ</i>
          <span className="lbl">Журнал</span>
        </button>
        <button className="gs-nav-btn" onClick={onToggleSide} aria-pressed={sideOpen} title="Показать/скрыть боковую панель" data-testid="nav-side">
          <i className="ico" aria-hidden="true" style={{ fontSize: 10 }}>ПА</i>
          <span className="lbl">Панель</span>
        </button>
      </div>
    </nav>
  );
}
