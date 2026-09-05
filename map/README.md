# map/

PixiJS карта среза Европа-16 — реализована в T3.

- Рендер: `ui/components/MapCanvas.tsx` на PixiJS v7, без DOM-элемента на регион.
- Геометрия: `projectLonLat` переводит lon/lat → world px (WORLD_SCALE 12), кэш `Map<regionId, { gfx: Graphics, polygonWorld }>` хранит полигоны; перерисовывается только дифф выбора/режима (fill/border, не пересоздание геометрии).
- Зум/пан: wheel (0.92/1.08, якорь под курсором), drag, двойной клик — сброс. Clamp 0.5…8, initial fit 0.6…2.5 по контейнеру.
- Интерактив: hit-test `pointInPolygon` по кэшированным `polygonWorld`, hover tooltip, click → `selectRegion`/`selectCountry` в Zustand store.
- Слои: море → регионы (political: country color, military: terrain sand/hills) → морские переправы (3 в сценарии, GB-FR ≥1) → столицы ★ (золото для игрока) → маркеры войск (military, пустое состояние — T5 заменит).
- Границы: внешняя толще (selected country 1.8px, selected region 2.5px, hover золото), внутренняя 1px.
- Столица: Graphics star, игрок — золотой ободок.
- Войска/приказы: в `military` — серые точки + перекрестие на выбранном (T5: units/orders), сейчас «нет войск» с объяснением.
- Война/оккупация: overlay штрих (T6) — сейчас пусто, контролёр=владелец, «оккупация ≠ аннексия».
- Режимы: `political` vs `military`, переключатель в `App.tsx`, дифф-обновление без пересоздания сцены.
- Данные: `sim/scenario.ts` + `data/*.json` (16 стран, 64 региона, adjacency по общей границе, crossings отдельно).

Монтирование панелей следующих тикетов — контракты в `ui/components/SidePanel.tsx`:
```
mount: ui/panels/EconomyPanel countryId
mount: ui/panels/ArmyPanel   countryId/regionId
mount: ui/panels/WarPanel
```
