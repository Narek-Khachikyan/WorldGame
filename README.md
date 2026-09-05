# World Balance — Europe-16 (Slice A) — T1

Vertical slice A-min: однопользовательская браузерная стратегия про современный мир, срез Европы-16. T1 — каркас + ядро симуляции + время.

## Стек

TypeScript + React + Vite + PixiJS + Zustand + Vitest + Playwright (сим — чистый TS без React/PixiJS).

## Запуск

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # Vitest (one command) — unit-тесты сима
npm run build  # production build (tsc + vite)
```

Node ≥ 20.

## Что работает в T1

- **Проектный каркас**: `npm install / npm run dev / npm test / npm run build` работают. Настроены Vite + React плагин, Vitest (node env), пути `sim/` `data/` `rules/` `map/` `ui/`.
- **Календарь**: единый, старт `2026-01-01`, базовый шаг 1 игровой день (`sim/calendar.ts`, `START_DATE`). Корректный переход месяцев/лет, високосный 2028. `GameCalendar.tick(days)` — детерминирован.
- **Seeded RNG**: mulberry32 (`sim/rng.ts`, `SeededRng`). Seed хранится в `SimEngine.seed`, доступен через `getSeed()`/`getRngState()`, воспроизводим: same seed ⇒ same sequence. Используется в `tick` (1 вызов RNG в день) и в командах для доказательства детерминизма.
- **Скорости времени (fixed-timestep аккумулятор)**: `rules/time.json` — константы `{ slow:1, normal:3, fast:7 }` дней/сек, `defaultSpeed: normal`, `baseStepDays:1`. `sim/time.ts: TimeAccumulator` копит `deltaSeconds * daysPerSecond` и отдаёт целые дни, дробный остаток сохраняет. Пауза = `paused` (0 дн/сек). Частота кадров не влияет: разные нарезки одного `totalSeconds` дают одинаковые `totalDays` (покрыто тестами).
- **Валидатор команд (скелет)**: `sim/validator.ts: validateCommand` — whitelist `noop | testPing | incrementCounter` с проверкой payload, неизвестные типы отклоняются с `reason`. Расширяется в T4-T7 без ломки тестов T1.
- **Журнал событий (скелет)**: `sim/eventLog.ts: EventLog` — `append(date,kind,payload)` с авто-id, `getAll()`, `getTail(n)`, `getByKind()`, `clear()`. Используется движком для `commandRejected/Accepted`, `testPing`, `incrementCounter`, `dayTick`.
- **SimEngine (чистый TS)**: `sim/engine.ts: SimEngine` / `createSim({seed,startDate})` — публичный шов `commands + tick(days) + queries + eventLog` без React/PixiJS. Методы: `getDate()`, `getDaysElapsed()`, `getSeed()`, `getSnapshot()`, `getCustomState()`, `getEventLog()`, `dispatch(cmd)`, `tick(days)`. Ticks детерминированы, `customState` для теста детерминизма.
- **Структура**: `sim/` (движок), `data/` (placeholder + `data/README.md`/`attribution.md` для NE + лидеров), `rules/time.json`, `map/` (placeholder), `ui/` (React + Zustand store с `TimeAccumulator` и `requestAnimationFrame`, топбар дата/пауза/скорости, `ui/locales/ru.json`).
- **UI оболочка (минимальная, T1)**: дата, пауза/3 скорости, счётчик дней/тиков, `customState` и хвост журнала. Карта PixiJS — в T3 (показывает placeholder).

## Что ещё не работает (будет в следующих тикетах)

Сценарий и геоданные (T2), карта PixiJS и оболочка UI полностью (T3), экономика/стройка/налоги (T4-T5), армии/война/мир/режимы/выборы/ИИ (T5-T7), сейв/лоад (T8). Любые кнопки помимо топбара/журнала в T1 — заглушки с объяснением в UI-плашке.

## Публичный шов для тестов

```ts
import { createSim } from "./sim/index.js";
import { TimeAccumulator } from "./sim/time.js";

const sim = createSim({ seed: 42 });
sim.dispatch({ type: "incrementCounter", payload: { key: "a", delta: 5 } }); // validate → apply
sim.tick(30); // 30 game days, deterministic
sim.getSnapshot(); // { date, daysElapsed, seed, tickCount, customState }
sim.getEventLog(); // SimEvent[]
```

Тесты бьют только в этот шов, не во внутренности (см. `sim/__tests__/`). Проверено: календарь, RNG, валидатор, журнал, время (пауза/скорости, frame-rate invariance), детерминизм seed+commands.

## Контракты T1 для merger

- T1 — единственный frontier; T2-T8 заблокированы. Изменения ограничены каркасом/симом/временем; экономика/армия/карта не трогаются кроме скелетных типов.
- `rules/time.json` — единственный источник скоростей; не хардкодить 1/3/7 в коде.
- `sim/` без зависимостей от React/PixiJS/Zustand.
- Ветка `impl/wb-t1-core-time` из `feat/spec-1-slice-A` (commit 355c189). Worktree `/tmp/wb-t1-impl`. Ожидается fast-forward, конфликтов нет (greenfield).
