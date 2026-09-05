# World Balance — Europe-16 (Slice A) — T1–T8 complete

Вертикальный срез A-min: однопользовательская браузерная стратегия про современный мир, срез Европы-16. Завершён финал среза (T8): базовый ИИ, сейв/лоад, приёмка. Ранее T1–T7 уже в `feat/spec-1-slice-A` (6c83056, 122 теста), T8 добавлен в этой ветке.

## Стек

TypeScript + React + Vite + PixiJS + Zustand + Vitest + Playwright (сим — чистый TS без React/PixiJS).

## Запуск

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # Vitest — 145 тестов (sim + ui)
npm run build  # tsc --noEmit + vite build
npx playwright test          # e2e (требует npm run dev или webServer из playwright.config.ts)
npx playwright test e2e/full-cycle.spec.ts  # только полный цикл
```

Node ≥ 20. Для Playwright, если браузеры не установлены: `npx playwright install --dry-run` покажет что нужно; фактическая установка `npx playwright install`.

## Что работает (весь срез A)

- **Карта/оболочка (T2–T3)**: Natural Earth Admin-0 1:50m локально в `data/` (public domain, атрибуция в `data/attribution.md`), 16 стран (GB,FR,ES,IT,DE,PL,SE,RO,GR,UA,TR,BY,CZ,AT,HU,RS) × 4 региона = 64 региона (диапазон 60–120), `generated:true`, без перекрытий, соседство по общей границе, морские переправы отдельным списком (`data/crossings.json`), остров UK играется честно (море без переправы отклоняется с причиной «переправа»). PixiJS, кеш геометрии, дифф-only, режимы карты политический + военный, выбор страны/региона, TopBar дата + пауза/3 скорости, SidePanel контекст.
- **Время (T1)**: базовый шаг 1 игровой день, `rules/time.json` `{slow:1, normal:3, fast:7}` дней/сек, `TimeAccumulator` fixed-timestep, рендер независим. Экономика помесячно, ИИ каждые 14 дней.
- **Экономика (T4)**: казна/доход/расход раздельно, ВВП — не кошелёк, единый налог (`setTax`), 4 веса (`setWeights`: defense/infra/social/edu с лагом ~6 мес.), 3 типа строек (`startProject`: промышленный комплекс 300₥/90д, энергоблок 220/60, инфра 120/45, лимит 2 слота/регион), прогноз до подтверждения (стоимость/срок/выгода/риск/почему недоступно).
- **Армия (T5)**: группировки (`recruitUnit`: personnel/equipment/readiness, найм 14 дн., лимиты население/оснащение/бюджет), перемещение `moveUnit` только по сухопутному соседству или морской переправе, бой `strength = personnel×equipment×readiness` + оборона ×1.25 × укрепления × местность (равнина×1.0/горы×1.4/город×1.5) × снабжение (>3 регионов от столицы ×0.7) × ±10% seeded RNG, оккупация = смена контролёра, не владельца.
- **Война/мир (T6)**: `declareWar` (цена казна 0, угроза +15), `proposePeace` (white / annexOccupied / indemnity 250₥), юрвладелец меняется только миром, истощение `days×0.6 + потери/1000×6 + оккупировано×5 + потеряно×7`, AI `evaluatePeaceAI` с топ-2 причинами, союзов нет (автовтягивания нет).
- **Политика (T7)**: 4 режима (`liberalDemocracy/electoralDemocracy/authoritarian/oneParty`, игровые ярлыки, числа в `rules/politics.json`), лидеры с инициалами (`data/leaders.json`, портреты только свободные лицензии), смена режима как дорогое решение (цена 220₥, −14 стабильности, лаг 180–360д, кулдаун 730д, запрет при войне/потере столицы), смена персоны внутри режима = косметика + дрейф поддержки, выборы каждые 5 лет в свою дату (`electionMonth/Day`), `retainP = f(support,stability,fatigue,economy,regimeBonus,RNG)`, смена партии → `foreignStance` дельты к отношениям/доверию + ИИ переоценка.
- **ИИ (T8)**: `sim/ai.ts` — чистый, использует только публичные команды `setTax/setWeights/startProject/recruitUnit/moveUnit/declareWar/proposePeace` с теми же ценами/сроками/лимитами, без скрытых денег/мгновенных подкреплений. Приоритеты: 1) не обанкротиться, 2) гарнизон столицы (1 готовый отряд), 3) экономика, 4) защита важного (возврат своей земли), 5) война только при ~1.5× и выгоде (cautious 1.8×/казна 600/долг≤150, ambitious 1.4×/250/350, два профиля через `rules/ai.json`), проигрывая → просит белый мир, причины решений в `eventLog` вид `aiDecision` с `causes`. Стратегия каждые 14 игровых дней per country AI-controlled (все кроме `playerCountryId`) + по событиям война/мир/банкротство/выборы. **Хук**: standalone `runAIStep(sim, countryId, {reason})` вызывается `ui/store.ts:tickReal`/`dispatch` (каждые 14д + события) — документировано в `sim/ai.ts` header и `ui/store.ts`. Мирное развитие жизнеспособно (тест 2 года без войны → ≥1 стройка, долг <1000).
- **Сейвы (T8)**: `sim/save.ts` — `saveGame(sim): SaveV1` / `loadGame(json): {ok, sim|error}`. SaveV1 `version:1, seed, date, daysElapsed, tickCount, rngState, nextIds, economies, countryEconomy, regions, units, wars, threats, politics, relations, trust, logTail(100), playerCountryId, aiProfiles`. Валидация при загрузке, битый/несовместимый сейв = `{ok:false, error}` с понятным двуязычным сообщением без краша. Локальные слоты `wb-save-slot-1..3` (`localStorage`) + экспорт/импорт файла (JSON download/upload) в `ui/panels/SavePanel.tsx`. Кнопки: `btn-save-slot-*`, `btn-load-slot-*`, `btn-export-save`, `input-import-file`, ошибка `save-error`.
- **Журнал**: `eventLog` с приоритетами, без спама, причины как в T4–T8, включая `aiDecision`.

## Игровой цикл

- Пауза + 3 скорости через аккумулятор (1 / 3 / 7 дн/сек). Экономика помесячно (1-е число), стройки завершаются в срок, армия `tick` ежедневно (готовность + содержание), война истощение + политика ежедневно + выборы в дату. ИИ — каждые 14д + события. Все числа — модельные коэффициенты в `rules/` (`economy.json`, `army.json`, `war.json`, `politics.json`, `ai.json`, `time.json`), факты (границы/столицы/лидеры/даты) — в `data/` с источниками.

## Тесты и результаты

- `npm test` — Vitest, 145 тестов (было 122 + 23 новых T8) — зелёные. Покрыто:
  - календарь/время/скорости/frame-rate invariance/RNG/валидатор/журнал/детерминизм (seed+команды),
  - сценарий/геоданные (16 стран, 64 региона, остров/landlocked, соседство по границе, переправы),
  - экономика (деньги из воздуха невозможны, долг+проценты, потеря промрегиона),
  - армия (найм лимиты, море без переправы, бой формула, снабжение, захват≠аннексия),
  - война/мир (владелец только миром, 3 опции мира, AI топ-2 причины, без союзов),
  - политика (режимы, смена режима/персоны, выборы дата/период 5 лет, дипломатия дельты, кризис постепенный),
  - **T8 новое**: `save.test.ts` (roundtrip, слоты, экспорт/импорт, битый JSON, несовместимая версия), `ai.test.ts` (ИИ без читов, приоритеты, гарнизон, экономика, война 1.5×, проигрыш→мир, 2 профиля, мирное развитие), `soak.test.ts` (10 лет с ИИ без NaN/взрывов/циклов, детерминизм seed+AI, банкротства/потери столицы/окружение/оккупация/уничтожение армии).
- **Детерминизм**: `seed + команды = identical` — проверено в `determinism.test.ts` и `soak.test.ts` (60д с ИИ). `save/load` продолженный `tick` даёт identical.
- **Soak (замер с условиями)**: 10 лет = 3650 игровых дней, ИИ каждые 14д по 15 странам, на `darwin Node v26.3.1` single-thread, без PixiJS, Vitest jsdom, измерено wall-clock `Date.now()` вокруг цикла `tick(1)` + AI: **1314–1559 мс** (варьирует, порог теста <8000 мс). Казна/долг/GDP/support/stability — конечны, не NaN, не ∞, в границах (−10000..100000, GDP 0..10000, stability 0..100). Дата advanced на 3650.
- **Playwright**: `e2e/full-cycle.spec.ts` — полный цикл выбор (GB) → стройка (regionInfra) → найм (1200) → 14д готовность → война GB→FR → оккупация FR-1 → мир белый → сейв/лоад слот 1 (изменение налога и восстановление) → экспорт/импорт видимы → битый сейв = понятная ошибка (inject `wb-save-slot-2` с невалидным JSON, проверка `save-error`). Требует `npm run dev` + `npx playwright test` (порт 5173, `reuseExistingServer: !CI`). Если браузеры не установлены — `npx playwright install --dry-run` покажет список, установка `npx playwright install`.
- **Крайние случаи**: банкротство (долг 600, казна 10 → warning, без краша), потеря столицы (DE→PL, crisis), окружение (HU far region → penalty 0.7), полная оккупация (RS все 4 региона → FR), уничтожение последней армии (SE delete → AI rebuild).

## Ограничения (что не в A)

Снабжение — только базовый штраф >3 регионов (полная сеть — Этап B). Торговля/зависимости/санкции — нет. Дипломатия — только `declareWar/proposePeace` + `relations/trust` нейтраль 50 + stance-дельты, без торговли. Усталость от войны — только `warFatigueLite` (0..100) без глубокой системы. ИИ режим не меняет. Карта — 64 региона (упрощённые прямоугольники), не весь мир.

## Следующий небольшой этап (Stage B start)

По итогам A: **B-начало — сеть снабжения + усталость от войны**: граф снабжения по регионам/соседству/переправам (вместо штрафа 0.7 — вычислять связность/перерезанные линии), расширить `warFatigueLite` в систему с эффектами на производство/стабильность/войну, подготовка для торговли/санкций. Альтернатива — расширение пулов лидеров (больше портретов/партий). Выбор — по итогам приёмки.

## Публичный шов

```ts
import { createSim } from "./sim/index.js";
import { runAIStep } from "./sim/ai.js";
import { saveGame, loadGame } from "./sim/save.js";

const sim = createSim({ seed: 42 });
sim.setPlayerCountryId("GB"); // AI контролирует всех кроме GB
sim.dispatch({ type: "setTax", payload: { countryId: "GB", taxRate: 0.27 } });
sim.dispatch({ type: "startProject", payload: { countryId: "GB", regionId: "GB-1", projectType: "regionInfra" } });
sim.dispatch({ type: "recruitUnit", payload: { countryId: "GB", regionId: "GB-1", personnel: 1200, equipment: 0.85 } });
for (let d=0; d<28; d++) {
  sim.tick(1);
  if (sim.getDaysElapsed() % 14 === 0) runAIStep(sim, "FR", { reason: "interval14" }); // ИИ хук — standalone, каждые 14д + события
}
const save = saveGame(sim); const json = JSON.stringify(save);
const { ok, sim: sim2, error } = loadGame(json) as {ok:true, sim:typeof sim} | {ok:false, error:string};
if (!ok) console.error(error); // понятная ошибка без краша
```

Тесты бьют только в этот шов (см. `sim/__tests__/`).

## Контракты для merger

- T8 — final frontier (#9), blocked-by #4 #5 #6 #7 #8 done, ветка `impl/wb-t8-ai-saves` из `feat/spec-1-slice-A` (6c83056). Worktree `/tmp/wb-t8-impl`. Ожидается fast-forward в `feat/spec-1-slice-A` затем PR #10.
- `rules/ai.json` — единственный источник порогов ИИ, `rules/time.json` — скоростей.
- `sim/` без React/PixiJS/Zustand (кроме чистого `sim/ai.ts` и `sim/save.ts`).
- UI: `ui/panels/SavePanel.tsx` + AI статус в `ui/components/SidePanel.tsx` (профиль selector), `TopBar` показывает казну/войны/стройки.
