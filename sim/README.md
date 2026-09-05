# Sim — pure TS core (no React/PixiJS)

Public seam: `createSim` + `dispatch(Command)` + `tick(days)` + queries + `eventLog` + `saveGame/loadGame` + `runAIStep`.

## Domain sections (Large Class mitigation)

`SimEngine` is 2k+ lines but seams are documented (header comments):
- Calendar/Time (tick, day==1 monthly)
- Economy (treasury/income/expense, projects, monthly tick)
- Army (units, hiring, movement, combat, supply, upkeep)
- War (declareWar/proposePeace, exhaustion, threat)
- Politics (regimes, elections, crisis, relations/trust)
- AI/Saves (profiles, interval, persistence)

Full split to facades is out of scope for Slice A; headers mark future extraction points.

## Command-adding checklist (Shotgun Surgery mitigation)

To add a new command type, touch:
1. `sim/validator.ts` — add to `COMMAND_SPECS` + payload checks
2. `sim/types.ts` — if new snapshot fields
3. `sim/engine.ts` — dispatch handler + forecast (if needed) + header checklist reference
4. `rules/*.json` — if model coefficients
5. `ui/panels/*` — caller UI

This checklist is authoritative for Slice A.

## Type aliases (Data Clumps / Primitive Obsession)

- `CountryFunds` = treasury/population/equipment trio
- `PoliticalHealth` = stability/support/warFatigue
- `CountryId`, `RegionId`, `TaxRate` branded strings — validated at dispatch, runtime remains string
- `DiplomacyMap` = directed relations/trust

## Helpers to avoid Message Chains / Feature Envy

- `engine.getTreasury(cid)`, `getDebt(cid)`, `getBalance(cid)` — single-point access
- `engine.getCountryMilitarySummary(cid)` — AI uses engine helper instead of reaching into internals
- `engine.applyRegionControlTransfer` — deduplicates income calc for region loss/gain

## Mysterious Names

- `customState` = legacy T1 scratch (alias `scenarioScratch` via getter)
- `warFatigueLite` = `warFatigue` (0..100) — kept for save compat, alias via `PoliticalHealth.warFatigue`
- `anySim` removed — use `sim.appendEvent` public seam
