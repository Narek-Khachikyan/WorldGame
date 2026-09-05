import { test, expect } from "@playwright/test";

test("T8 full-cycle: select → build → hire → war → peace → save/load", async ({ page }) => {
  await page.goto("/");
  // header and date
  await expect(page.getByText("World Balance")).toBeVisible();
  await expect(page.getByText("2026-01-01")).toBeVisible();

  // select country GB via card
  await expect(page.getByTestId("country-selection")).toBeVisible();
  await page.getByTestId("country-card-GB").click();
  await expect(page.getByTestId("btn-start-game")).toBeVisible();
  await page.getByTestId("btn-start-game").click();

  // collapse selection auto after 800ms, but check player indicator appears
  await expect(page.getByText(/Играете за/)).toBeVisible({ timeout: 3000 });
  // also check topbar still shows treasury etc.
  await expect(page.getByTestId("topbar")).toBeVisible();
  // after start, selection should collapse but still selectable via toggle
  // ensure SidePanel shows context for GB
  await expect(page.getByTestId("side-panel")).toBeVisible();
  // Check AI panel appears for non-player? For GB it's player, so shows "ИИ — игрок"
  await expect(page.getByText(/ИИ — игрок/)).toBeVisible();

  // Switch AI profile for a neighbour to test selector (e.g., FR)
  // Select FR on map/card? Use side panel selector: choose FR via card again? Simpler via evaluate selectCountry
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { selectCountry: (id:string)=>void } } }).__GAME_STORE__;
    store.getState().selectCountry("FR");
  });
  await expect(page.getByText("Франция")).toBeVisible();
  // AI profile buttons should be visible for FR (non-player)
  await expect(page.getByTestId("btn-ai-profile-cautious-FR")).toBeVisible();
  await page.getByTestId("btn-ai-profile-ambitious-FR").click();
  // switch back to GB for economy actions
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { selectCountry: (id:string)=>void } } }).__GAME_STORE__;
    store.getState().selectCountry("GB");
  });

  // BUILD — economy: start project via evaluate for reliability, then verify UI
  // Check EconomyPanel shows treasury
  await expect(page.getByText("Экономика — GB")).toBeVisible();
  // Ensure forecast box and button "Начать стройку" visible
  await expect(page.getByRole("button", { name: "Начать стройку" })).toBeVisible({ timeout: 2000 });
  // Click build via UI
  const beforeBuildCount = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{activeProjects:unknown[]} } } } }).__GAME_STORE__;
    const eco = store.getState().sim.getEconomy("GB")!;
    return eco.activeProjects.length;
  });
  await page.getByRole("button", { name: "Начать стройку" }).first().click();
  // verify project added via evaluate
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{activeProjects:unknown[]} } } } }).__GAME_STORE__;
      return store.getState().sim.getEconomy("GB")!.activeProjects.length;
    });
  }).toBe(beforeBuildCount + 1);

  // HIRE — army: recruit unit
  await expect(page.getByRole("heading", { name: /Армия/ })).toBeVisible();
  const beforeUnits = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>unknown[] } } } }).__GAME_STORE__;
    return store.getState().sim.getUnits().length;
  });
  // Use hire button — ArmyPanel defaults to GB GB-1
  await page.getByRole("button", { name: /Нанять/ }).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>unknown[] } } } }).__GAME_STORE__;
      return store.getState().sim.getUnits().length;
    });
  }).toBe(beforeUnits + 1);
  // Verify unit shows in list
  await expect(page.getByText(/наём запущен/i)).toBeVisible({ timeout: 2000 });

  // Need to tick 14 days for unit ready (hiring time)
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { tick:(n:number)=>void } } } }).__GAME_STORE__;
    store.getState().sim.tick(14);
  });
  // Check unit ready via evaluate
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>Array<{daysUntilReady:number}> } } } }).__GAME_STORE__;
      const units = store.getState().sim.getUnitsByCountry("GB") as Array<{daysUntilReady:number}>;
      return units.length >0 && units[0].daysUntilReady===0;
    });
  }).toBe(true);

  // WAR — declare war GB → FR via WarPanel UI
  await expect(page.getByTestId("war-panel")).toBeVisible();
  // Ensure attacker GB defender FR selected by default (WarPanel defaults)
  // Change if needed via evaluate to ensure correct
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: unknown } } }).__GAME_STORE__;
    // ensure no existing war GB-FR? If exists, skip
  });
  await page.getByTestId("btn-declare-war").click();
  // Check war appears
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getWars:()=>Array<{attackerId:string;defenderId:string}> } } } }).__GAME_STORE__;
      const wars = store.getState().sim.getWars();
      return wars.some((w) => w.attackerId==="GB" && w.defenderId==="FR" && w.status==="active");
    });
  }).toBe(true);
  await expect(page.getByText(/Активные войны/)).toBeVisible();
  await expect(page.getByText("GB → FR")).toBeVisible({ timeout: 2000 });

  // Move unit into FR to capture (simulate war progress)
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>Array<{unitId:string;countryId:string}>, dispatch:(c:unknown)=>unknown } } } }).__GAME_STORE__;
    const sim = store.getState().sim as unknown as { getUnits:()=>Array<{unitId:string;countryId:string;regionId:string}>, getUnitsByCountry:(id:string)=>Array<{unitId:string}>, dispatch:(c:unknown)=>unknown, getScenario:()=>{adjacency:Record<string,string[]>, crossings:unknown[]} };
    // Find GB ready unit and move to FR-1 (capital) — need adjacency? GB is island, no adjacency to FR without crossing. Our scenario has at least one crossing? If not, move will fail. Try to use setRegionController hack to simulate occupation for peace test.
    // Instead dispatch war occupation via controller hack: directly set FR-1 controller to GB
    const simAny = store.getState().sim as unknown as { dispatch:(c:unknown)=>{ok:boolean} };
    simAny.dispatch({ type: "setRegionController", payload: { regionId: "FR-1", newControllerId: "GB" } });
  });
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getRegionState:(id:string)=>{controllerId:string} } } } }).__GAME_STORE__;
      return store.getState().sim.getRegionState("FR-1")!.controllerId;
    });
  }).toBe("GB");

  // PEACE — propose white peace via UI: select war for peace (click "Выбрать для мира")
  await page.getByRole("button", { name: "Выбрать для мира" }).first().click();
  // Now propose peace button should be enabled
  await page.getByTestId("btn-propose-peace").click();
  // Check either accepted or rejected but war should eventually be ended or proposal logged
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEventLog:()=>Array<{kind:string}> } } } }).__GAME_STORE__;
      const log = store.getState().sim.getEventLog();
      return log.some((e) => e.kind==="peaceProposed" || e.kind==="peaceAccepted" || e.kind==="peaceRejected");
    });
  }).toBe(true);
  // For deterministic, force tick a bit and try again until accepted: if rejected, try again with AI logic will eventually accept after exhaustion?
  // We'll tick 30 days to increase exhaustion
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { tick:(n:number)=>void } } } }).__GAME_STORE__;
    store.getState().sim.tick(30);
  });
  // Try propose again if war still active
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getWars:()=>Array<{warId:string;status:string}>, dispatch:(c:unknown)=>unknown } } } }).__GAME_STORE__;
    const wars = store.getState().sim.getWars().filter((w) => w.status==="active");
    for (const w of wars) {
      const simAny = store.getState().sim as unknown as { dispatch:(c:unknown)=>unknown };
      // try white peace from GB
      simAny.dispatch({ type: "proposePeace", payload: { warId: w.warId, proposer: "GB", type: "white" } });
    }
  });
  // Check war ended at least or still proposed
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getWars:()=>Array<{status:string}> } } } }).__GAME_STORE__;
      const wars = store.getState().sim.getWars();
      return wars.some((w)=> w.status==="ended") || wars.length===0;
    });
  }).toBe(true);

  // SAVE/LOAD — local slots + file export/import shape
  await expect(page.getByTestId("save-panel")).toBeVisible();
  // Save to slot 1
  await page.getByTestId("btn-save-slot-1").click();
  await expect(page.getByTestId("save-msg")).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("save-msg")).toContainText(/сохранено в слот 1/i);
  // Verify slot info updated
  // Mutate state: change tax to create difference
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { dispatch:(c:unknown)=>unknown } } } }).__GAME_STORE__;
    store.getState().sim.dispatch({ type: "setTax", payload: { countryId: "GB", taxRate: 0.45 } });
  });
  const taxAfterMutation = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{taxRate:number} } } } }).__GAME_STORE__;
    return store.getState().sim.getEconomy("GB")!.taxRate;
  });
  expect(taxAfterMutation).toBe(0.45);
  // Load from slot 1 — should restore previous tax (before mutation)
  await page.getByTestId("btn-load-slot-1").click();
  await expect(page.getByTestId("save-msg")).toContainText(/загружено из слота 1/i);
  const taxAfterLoad = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{taxRate:number} } } } }).__GAME_STORE__;
    return store.getState().sim.getEconomy("GB")!.taxRate;
  });
  // Should not be 0.45 (restored)
  expect(taxAfterLoad).not.toBe(0.45);

  // Export button visible, import input visible
  await expect(page.getByTestId("btn-export-save")).toBeVisible();
  await expect(page.getByTestId("input-import-file")).toBeVisible();

  // Broken save gives clear error without crash — via localStorage injection and via direct API
  // Inject broken JSON into slot 2 and attempt load via UI — should show clear error
  await page.evaluate(() => {
    localStorage.setItem("wb-save-slot-2", '{ "not": "valid save" }');
  });
  await page.getByTestId("btn-load-slot-2").click();
  await expect(page.getByTestId("save-error")).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("save-error")).toContainText(/повреждён|corrupted|несовместим|incompatible/i);
  // Now test incompatible version via direct API
  const brokenCheck = await page.evaluate(() => {
    const funcs = (window as unknown as { __SAVE_FUNCS__: { loadGame:(j:string)=>{ok:boolean; error?:string} } }).__SAVE_FUNCS__;
    const r1 = funcs.loadGame('{"not": "json" }'); // missing version etc -> should be false
    const r2 = funcs.loadGame('{"version":999, "seed":1, "date":"2026-01-01", "daysElapsed":0, "tickCount":0, "rngState":0, "economies":{}, "regions":[], "units":[], "wars":[], "politics":{}, "relations":{}, "trust":{}, "threats":{}, "countryEconomy":{}, "logTail":[], "customState":{}, "nextIds":{"nextUnitSeq":1,"nextProjectId":1,"nextWarId":1}}');
    const r3 = funcs.loadGame('not json at all');
    return { r1ok: r1.ok, r1err: !r1.ok ? (r1 as {error:string}).error : "", r2ok: r2.ok, r2err: !r2.ok ? (r2 as {error:string}).error : "", r3ok: r3.ok, r3err: !r3.ok ? (r3 as {error:string}).error : "" };
  });
  expect(brokenCheck.r1ok).toBe(false);
  expect(brokenCheck.r2ok).toBe(false);
  expect(brokenCheck.r3ok).toBe(false);
  expect(brokenCheck.r1err).toMatch(/повреждён|corrupted|несовместим/i);
  expect(brokenCheck.r2err).toMatch(/несовместим|incompatible/i);
  expect(brokenCheck.r3err).toMatch(/повреждён|corrupted|invalid JSON/i);

  // Verify save JSON shape via direct API
  const saveShape = await page.evaluate(() => {
    const funcs = (window as unknown as { __SAVE_FUNCS__: { saveGame:(sim:unknown)=>{version:number; seed:number; date:string; economies:Record<string,unknown>; regions:unknown[]; units:unknown[]; politics:unknown; logTail:unknown[]} } }).__SAVE_FUNCS__;
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: unknown } } }).__GAME_STORE__;
    const save = funcs.saveGame(store.getState().sim as never);
    return {
      version: save.version,
      hasSeed: typeof save.seed === "number",
      hasDate: typeof save.date === "string",
      countriesCount: Object.keys(save.economies).length,
      regionsCount: save.regions.length,
      hasUnits: Array.isArray(save.units),
      hasPolitics: typeof save.politics === "object",
      hasLogTail: Array.isArray(save.logTail),
    };
  });
  expect(saveShape.version).toBe(1);
  expect(saveShape.countriesCount).toBe(16);
  expect(saveShape.regionsCount).toBeGreaterThanOrEqual(60);
});
