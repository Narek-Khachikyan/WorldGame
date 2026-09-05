import { test, expect } from "@playwright/test";

test("grand-strategy full-cycle: select → build → hire → war → peace → save/load", async ({ page }) => {
  await page.goto("/");
  // header and date
  await expect(page.getByText("World Balance")).toBeVisible();
  await expect(page.getByText("2026-01-01")).toBeVisible();

  // select country GB via card
  await expect(page.getByTestId("country-selection")).toBeVisible();
  await page.getByTestId("country-card-GB").click();
  await expect(page.getByTestId("btn-start-game")).toBeVisible();
  await page.getByTestId("btn-start-game").click();

  // player indicator in map overlay, start veil gone
  await expect(page.getByText(/Играете за/)).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId("country-selection")).toBeHidden({ timeout: 3000 });
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByTestId("side-panel")).toBeVisible();
  await expect(page.getByText(/ИИ — игрок/)).toBeVisible();
  // topbar separates scopes
  await expect(page.getByTestId("wars-indicator")).toContainText("Ваши войны");
  await expect(page.getByTestId("world-wars-indicator")).toContainText("В мире");

  // AI profile selector lives in DEV mode
  await page.getByTestId("btn-devmode").click();
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { selectCountry: (id:string)=>void } } }).__GAME_STORE__;
    store.getState().selectCountry("FR");
  });
  await expect(page.getByText("Франция")).toBeVisible();
  await expect(page.getByTestId("btn-ai-profile-cautious-FR")).toBeVisible();
  await page.getByTestId("btn-ai-profile-ambitious-FR").click();
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { selectCountry: (id:string)=>void } } }).__GAME_STORE__;
    store.getState().selectCountry("GB");
  });

  // BUILD — economy section
  await page.getByTestId("nav-economy").click();
  await expect(page.getByText("Экономика — GB")).toBeVisible();
  await expect(page.getByRole("button", { name: "Начать стройку" })).toBeVisible({ timeout: 2000 });
  const beforeBuildCount = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{activeProjects:unknown[]} } } } }).__GAME_STORE__;
    const eco = store.getState().sim.getEconomy("GB")!;
    return eco.activeProjects.length;
  });
  await page.getByRole("button", { name: "Начать стройку" }).first().click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{activeProjects:unknown[]} } } } }).__GAME_STORE__;
      return store.getState().sim.getEconomy("GB")!.activeProjects.length;
    });
  }).toBe(beforeBuildCount + 1);

  // HIRE — army section (player-only)
  await page.getByTestId("nav-army").click();
  await expect(page.getByTestId("army-panel")).toBeVisible();
  const beforeUnits = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>unknown[] } } } }).__GAME_STORE__;
    return store.getState().sim.getUnits().length;
  });
  await page.getByRole("button", { name: /Нанять/ }).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>unknown[] } } } }).__GAME_STORE__;
      return store.getState().sim.getUnits().length;
    });
  }).toBe(beforeUnits + 1);
  await expect(page.getByText(/наём запущен/i)).toBeVisible({ timeout: 2000 });

  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { tick:(n:number)=>void } } } }).__GAME_STORE__;
    store.getState().sim.tick(14);
  });
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>Array<{daysUntilReady:number}> } } } }).__GAME_STORE__;
      const units = store.getState().sim.getUnitsByCountry("GB") as Array<{daysUntilReady:number}>;
      return units.length >0 && units[0].daysUntilReady===0;
    });
  }).toBe(true);

  // WAR — diplomacy section with explicit confirmation
  await page.getByTestId("nav-diplomacy").click();
  await expect(page.getByTestId("war-panel")).toBeVisible();
  await page.getByTestId("war-confirm").check();
  await page.getByTestId("btn-declare-war").click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getWars:()=>Array<{attackerId:string;defenderId:string}> } } } }).__GAME_STORE__;
      const wars = store.getState().sim.getWars();
      return wars.some((w) => w.attackerId==="GB" && w.defenderId==="FR" && w.status==="active");
    });
  }).toBe(true);
  await expect(page.getByText(/Активные войны/)).toBeVisible();
  await expect(page.getByText("GB → FR").first()).toBeVisible({ timeout: 2000 });

  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getUnits:()=>Array<{unitId:string;countryId:string}>, dispatch:(c:unknown)=>unknown } } } }).__GAME_STORE__;
    const simAny = store.getState().sim as unknown as { dispatch:(c:unknown)=>{ok:boolean} };
    simAny.dispatch({ type: "setRegionController", payload: { regionId: "FR-1", newControllerId: "GB" } });
  });
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getRegionState:(id:string)=>{controllerId:string} } } } }).__GAME_STORE__;
      return store.getState().sim.getRegionState("FR-1")!.controllerId;
    });
  }).toBe("GB");

  // PEACE
  await page.getByRole("button", { name: "Выбрать для мира" }).first().click();
  await page.getByTestId("btn-propose-peace").click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEventLog:()=>Array<{kind:string}> } } } }).__GAME_STORE__;
      const log = store.getState().sim.getEventLog();
      return log.some((e) => e.kind==="peaceProposed" || e.kind==="peaceAccepted" || e.kind==="peaceRejected");
    });
  }).toBe(true);
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { tick:(n:number)=>void } } } }).__GAME_STORE__;
    store.getState().sim.tick(30);
  });
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getWars:()=>Array<{warId:string;status:string}>, dispatch:(c:unknown)=>unknown } } } }).__GAME_STORE__;
    const wars = store.getState().sim.getWars().filter((w) => w.status==="active");
    for (const w of wars) {
      const simAny = store.getState().sim as unknown as { dispatch:(c:unknown)=>unknown };
      simAny.dispatch({ type: "proposePeace", payload: { warId: w.warId, proposer: "GB", type: "white" } });
    }
  });
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getWars:()=>Array<{status:string}> } } } }).__GAME_STORE__;
      const wars = store.getState().sim.getWars();
      return wars.some((w)=> w.status==="ended") || wars.length===0;
    });
  }).toBe(true);

  // SAVE/LOAD — via game menu
  await page.getByTestId("btn-menu").click();
  await expect(page.getByTestId("game-menu")).toBeVisible();
  await expect(page.getByTestId("save-panel")).toBeVisible();
  await page.getByTestId("btn-save-slot-1").click();
  await expect(page.getByTestId("save-msg")).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("save-msg")).toContainText(/сохранено в слот 1/i);
  await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { dispatch:(c:unknown)=>unknown } } } }).__GAME_STORE__;
    store.getState().sim.dispatch({ type: "setTax", payload: { countryId: "GB", taxRate: 0.45 } });
  });
  const taxAfterMutation = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{taxRate:number} } } } }).__GAME_STORE__;
    return store.getState().sim.getEconomy("GB")!.taxRate;
  });
  expect(taxAfterMutation).toBe(0.45);
  await page.getByTestId("btn-load-slot-1").click();
  await expect(page.getByTestId("save-msg")).toContainText(/загружено из слота 1/i);
  const taxAfterLoad = await page.evaluate(() => {
    const store = (window as unknown as { __GAME_STORE__: { getState: () => { sim: { getEconomy:(id:string)=>{taxRate:number} } } } }).__GAME_STORE__;
    return store.getState().sim.getEconomy("GB")!.taxRate;
  });
  expect(taxAfterLoad).not.toBe(0.45);

  await expect(page.getByTestId("btn-export-save")).toBeVisible();
  await expect(page.getByTestId("input-import-file")).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem("wb-save-slot-2", '{ "not": "valid save" }');
  });
  await page.getByTestId("btn-load-slot-2").click();
  await expect(page.getByTestId("save-error")).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("save-error")).toContainText(/повреждён|corrupted|несовместим|incompatible/i);
  const brokenCheck = await page.evaluate(() => {
    const funcs = (window as unknown as { __SAVE_FUNCS__: { loadGame:(j:string)=>{ok:boolean; error?:string} } }).__SAVE_FUNCS__;
    const r1 = funcs.loadGame('{"not": "json" }');
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
