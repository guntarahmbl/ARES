import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().startsWith("http")) requests.push(r.url());
  });
  await page.goto(pathToFileURL(process.cwd() + "/dist/ares-path.html").href);
  await page.locator("#view-walk").click();
  await page.waitForFunction(() =>
    document.body.classList.contains("marswalk"),
  );
  await page.locator("#scene").focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(2000);
  await page.keyboard.up("w");
  const position = await page.locator("#walk-position").textContent();
  console.log("position", position);
  assert.ok(
    Math.hypot(
      parseFloat(position.match(/x ([\d.-]+)/)[1]),
      120 - parseFloat(position.match(/z ([\d.-]+)/)[1]),
    ) > 8,
  );
  assert.ok(parseFloat(await page.locator("#walk-energy").textContent()) < 60);
  await page.keyboard.press("c");
  assert.match(await page.locator("#walk-camera").textContent(), /first/);
  await page.keyboard.press("c");
  assert.match(await page.locator("#walk-camera").textContent(), /orbit/);
  await page.keyboard.press("c");
  await page.keyboard.press("Escape");
  assert.match(await page.locator("#walk-state").textContent(), /PAUSED/);
  const paused = await page.locator("#walk-position").textContent();
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  assert.equal(await page.locator("#walk-position").textContent(), paused);
  await page.locator("#walk-pause").click();
  await page.keyboard.down("w");
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  await page.keyboard.up("w");
  assert.match(await page.locator("#walk-state").textContent(), /PAUSED/);
  const beforeExit = await page.locator("#walk-position").textContent(),
    energy = await page.locator("#walk-energy").textContent();
  await page.locator("#walk-exit").click();
  await page.locator("#view-walk").click();
  assert.equal(await page.locator("#walk-position").textContent(), beforeExit);
  assert.equal(await page.locator("#walk-energy").textContent(), energy);
  await page.screenshot({ path: "dist/ares-marswalk.png", fullPage: true });
  await page.locator("#walk-guide").click();
  await page.waitForFunction(
    () => !document.querySelector("#walk-observe").disabled,
    {},
    { timeout: 60000 },
  );
  await page.waitForFunction(() =>
    document.querySelector("#walk-state").textContent.includes("MANUAL"),
  );
  await page.locator("#walk-observe").click();
  await page.locator("#target-detail").waitFor({ state: "visible" });
  const title = await page.locator("#detail-title").textContent();
  console.log("observed", title);
  assert.equal(await page.locator("#detail-body img").count(), 4);
  await page.locator("#detail-close").click();
  assert.match(await page.locator("#walk-state").textContent(), /PAUSED/);
  await page.locator("#walk-pause").click();
  await page.locator("#walk-loss").click();
  await page.locator("#walk-return").click();
  await page.locator("#walk-guide").click();
  try {
    await page.waitForFunction(
      () =>
        document
          .querySelector("#walk-state")
          .textContent.includes("MISSION COMPLETE"),
      {},
      { timeout: 60000 },
    );
  } catch (error) {
    console.log(await page.locator("#walk-hud").textContent());
    await page.screenshot({
      path: "dist/ares-walk-failure.png",
      fullPage: true,
    });
    throw error;
  }

  assert.match(await page.locator("#walk-home").textContent(), /^0 m/);
  await page.locator("#walk-exit").click();
  await page.locator("#reset").click();
  // Several short returns exercise completion between throttled HUD refreshes.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator("#view-walk").click();
    await page.locator("#scene").focus();
    await page.keyboard.down("w");
    await page.waitForTimeout(450);
    await page.keyboard.up("w");
    await page.locator("#walk-return").click();
    await page.locator("#walk-guide").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#walk-state")
          .textContent.includes("MISSION COMPLETE"),
      {},
      { timeout: 15000 },
    );
    await page.locator("#walk-exit").click();
    await page.locator("#reset").click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#view-walk").click();
  const touch = page.locator('[data-walk-key="w"]');
  await touch.dispatchEvent("pointerdown", { pointerId: 1 });
  await page.waitForTimeout(400);
  await touch.dispatchEvent("pointerup", { pointerId: 1 });
  assert.ok(
    parseFloat(
      (await page.locator("#walk-position").textContent()).match(
        /z ([\d.-]+)/,
      )[1],
    ) < 120,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "dist/ares-marswalk-mobile.png",
    fullPage: true,
  });
  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).startsWith("webgl")
        ? null
        : get.call(this, type, ...args);
    };
  });
  await fallback.goto(
    pathToFileURL(process.cwd() + "/dist/ares-path.html").href,
  );
  await fallback.locator("#view-walk").click();
  assert.equal(await fallback.locator("#map").isVisible(), true);
  assert.equal(await fallback.locator("#play").isDisabled(), false);
  await fallback.locator("#play").click();
  await fallback.waitForFunction(
    () => Number(document.querySelector("#progress").value) > 0,
  );
  await fallback.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "PASS: Marswalk manual travel, resources, three cameras, pause, focus loss, persistent view changes, explicit observation, energy loss, return playback, mission completion, touch controls, WebGL fallback and offline execution.",
  );
} finally {
  await browser.close();
}
