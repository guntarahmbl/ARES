import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1100 },
    }),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().startsWith("http")) requests.push(r.url());
  });
  await page.goto(pathToFileURL(process.cwd() + "/dist/ares-path.html").href);
  await page.waitForFunction(
    () => document.querySelector("#plan-state").textContent === "FEASIBLE",
  );
  assert.equal(await page.locator(".route-card").count(), 2);
  assert.equal(await page.locator(".target-check:checked").count(), 3);
  await page.locator("#sources-open").click();
  await page.locator("#sources").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#sources").textContent(),
    /Eight source products are locally integrated/,
  );
  await page.keyboard.press("Escape");
  await page.locator('[data-detail="A"]').first().click();
  await page.locator("#target-detail").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#detail-body").textContent(),
    /Observed rover camera position/,
  );
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("#detail-body img")).length === 4 &&
      Array.from(document.querySelectorAll("#detail-body img")).every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
  );
  await page.locator("#detail-close").click();
  await page.locator('[data-layer="minerals"]').check();
  await page.locator("#mineral-band").selectOption("d2300");
  assert.match(
    await page.locator("#map-legend").textContent(),
    /D2300.*native 18 m/,
  );
  assert.equal(await page.locator("#meda-summary tbody tr").count(), 7);
  const firstTarget = await page
    .locator("#targets .target-title")
    .first()
    .textContent();
  await page.locator('[data-order="A"][data-dir="1"]').click();
  assert.notEqual(
    await page.locator("#targets .target-title").first().textContent(),
    firstTarget,
  );
  await page.locator("#reset").click();
  await page.locator('[data-layer="slope"]').check();
  await page.locator("#opacity").fill("60");
  assert.match(await page.locator("#map-legend").textContent(), /Slope/);
  await page.locator("#zoom-in").click();
  await page.locator("#fit").click();
  assert.ok(
    await page.locator("#map").evaluate((c) => {
      const d = c
        .getContext("2d")
        .getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return d[3] === 255 && d[0] < 240 && c.height < 4000;
    }),
  );
  await page.screenshot({ path: "dist/ares-desktop.png", fullPage: true });
  await page.locator("#energy").fill("10");
  await page.locator("#energy").dispatchEvent("change");
  assert.equal(await page.locator("#plan-state").textContent(), "INFEASIBLE");
  assert.equal(await page.locator("#play").isDisabled(), true);
  await page.locator("#reset").click();
  await page.locator("#energy-loss").click();
  assert.equal(await page.locator("#plan-state").textContent(), "FEASIBLE");
  assert.match(
    await page.locator("#warning").textContent(),
    /Dropped lower-priority target/,
  );
  assert.ok((await page.locator(".target-check:checked").count()) < 3);
  await page.locator("#reset").click();
  await page.locator("#progress").fill("40");
  await page.locator("#progress").dispatchEvent("input");
  assert.notEqual(await page.locator("#elapsed").textContent(), "0.0 min");
  assert.match(await page.locator("#sim-status").textContent(), /On EVA/);
  await page.locator("#emergency").click();
  assert.equal(await page.locator(".route-card").count(), 1);
  assert.match(
    await page.locator("#explanation").textContent(),
    /Returns directly/,
  );
  assert.equal(await page.locator("#plan-state").textContent(), "FEASIBLE");
  await page.locator('[data-layer="envelope"]').uncheck();
  await page.locator('[data-layer="minerals"]').uncheck();
  await page.locator("#view-3d").click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#scene").isVisible(), true);
  assert.equal(await page.locator("#webgl-error").isVisible(), false);
  assert.ok(
    await page.locator("#scene").evaluate((c) => c.width > 0 && c.height > 0),
  );
  await page.screenshot({ path: "dist/ares-3d.png", fullPage: true });
  await page.locator("#play").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#sim-status")
        .textContent.includes("Mission complete"),
    {},
    { timeout: 30000 },
  );
  assert.match(await page.locator("#return-cost").textContent(), /^0/);
  await page.locator("#reset").click();
  await page.locator("#close-area").click();
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.65);
  assert.equal(await page.locator("#clear-closures").isVisible(), true);
  await page.locator("#clear-closures").click();
  assert.equal(await page.locator("#clear-closures").isVisible(), false);
  await page.locator("#move-home").click();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.55);
  assert.match(await page.locator("#warning").textContent(), /Habitat moved/);
  const download = page.waitForEvent("download");
  await page.locator("#briefing").click();
  const artifact = await download;
  assert.equal(artifact.suggestedFilename(), "ares-mission-briefing.json");
  const exported = JSON.parse(await readFile(await artifact.path(), "utf8"));
  assert.match(exported.coordinateSystem, /3396190/);
  assert.ok(
    exported.route.coordinates.every(
      (c) => c.longitude > 77 && c.latitude > 18 && c.height < -2500,
    ),
  );
  assert.ok(!JSON.stringify(exported).includes("data:image"));
  assert.equal(exported.sources.length, 8);
  await page.locator("#reset").click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("#energy-loss").click();
  assert.equal(await page.locator("#plan-state").textContent(), "FEASIBLE");
  await page.screenshot({ path: "dist/ares-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "PASS: offline standalone, routes, provenance, reorder, layers, energy constraints, adaptation, simulation, emergency return, 3D, mission completion, closures, habitat, export, mobile; no page errors or network requests.",
  );
} finally {
  await browser.close();
}
