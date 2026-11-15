import { expect, test } from '@playwright/test'

const ready = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
}

test('tutorial can be replayed from settings and walks through both views', async ({ page }) => {
  await ready(page)
  await expect(page.getByTestId('tutorial')).toHaveCount(0)
  await page.getByRole('button', { name: 'App settings' }).click()
  await page.getByRole('button', { name: 'Replay tutorial' }).click()
  const tutorial = page.getByTestId('tutorial')
  await expect(tutorial).toContainText('Welcome to ARES Path')
  for (let step = 0; step < 20 && await tutorial.getByRole('button', { name: 'Next' }).count(); step += 1) {
    await tutorial.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.locator('.marswalk-shell')).toBeVisible()
  await tutorial.getByRole('button', { name: 'Done' }).click()
  await expect(tutorial).toHaveCount(0)
  // Replay still works after the tutorial has been completed.
  await page.getByRole('button', { name: 'App settings' }).click()
  await page.getByRole('button', { name: 'Replay tutorial' }).click()
  await expect(tutorial).toContainText('Step 1 of')
  await page.keyboard.press('Escape')
  await expect(tutorial).toHaveCount(0)
})

test('reset to our proposed route is one click in the planner', async ({ page }) => {
  await ready(page)
  const reset = page.getByRole('button', { name: /proposed route/i })
  await expect(reset).toBeDisabled()
  const stops = page.locator('[data-tour="traverse"] li[draggable="true"]')
  const initial = await stops.count()
  await page.getByRole('button', { name: /^Remove / }).first().click()
  await expect(stops).toHaveCount(initial - 1)
  await expect(reset).toBeEnabled()
  await reset.click()
  await expect(stops).toHaveCount(initial)
  await expect(reset).toBeDisabled()
})

test('dragging a stop previews the new order and only commits on drop', async ({ page }) => {
  await ready(page)
  const stops = page.locator('[data-tour="traverse"] li[draggable="true"]')
  const names = () => stops.locator('strong').allTextContents()
  const before = await names()
  expect(before.length).toBeGreaterThan(1)
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  const target = await stops.nth(1).boundingBox()
  if (!target) throw new Error('Stop row has no box')
  const below = { clientX: target.x + 20, clientY: target.y + target.height - 4, dataTransfer }

  await stops.nth(0).dispatchEvent('dragstart', { dataTransfer })
  await stops.nth(1).dispatchEvent('dragover', below)
  const preview = [before[1], before[0], ...before.slice(2)]
  expect(await names()).toEqual(preview)
  // Cancelled drag: no drop, so the original order comes back.
  await stops.nth(1).dispatchEvent('dragend', { dataTransfer })
  expect(await names()).toEqual(before)

  await stops.nth(0).dispatchEvent('dragstart', { dataTransfer })
  await stops.nth(1).dispatchEvent('dragover', below)
  await stops.nth(1).dispatchEvent('drop', { dataTransfer })
  await stops.nth(1).dispatchEvent('dragend', { dataTransfer })
  await expect.poll(names).toEqual(preview)
})

test.describe('touch free walk', () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })

  test('joystick sits clear of the controls and follows the side setting', async ({ page }) => {
    await ready(page)
    await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
    await expect(page.locator('.terrain-loader')).toHaveCount(0, { timeout: 10_000 })
    const joystick = page.getByLabel('Walk joystick')
    await expect(joystick).toHaveCount(0)
    await page.getByRole('button', { name: /Guided Tour/i }).click()
    await expect(joystick).toBeVisible()
    const stick = (await joystick.boundingBox())!
    const controls = (await page.locator('[data-tour="walk-mode"]').boundingBox())!
    expect(stick.y + stick.height).toBeLessThanOrEqual(controls.y)
    expect(stick.x + stick.width / 2).toBeLessThan(180)

    // Push the stick up: the astronaut walks.
    const start = await page.evaluate(() => fetch('/api/v1/bootstrap').then((response) => response.json()).then((data) => data.default_mission.habitat))
    await joystick.dispatchEvent('pointerdown', { pointerId: 7, clientX: stick.x + stick.width / 2, clientY: stick.y + stick.height / 2 })
    await joystick.dispatchEvent('pointermove', { pointerId: 7, clientX: stick.x + stick.width / 2, clientY: stick.y + 6 })
    await page.waitForTimeout(900)
    await joystick.dispatchEvent('pointerup', { pointerId: 7 })
    const request = page.waitForRequest((candidate) => candidate.url().endsWith('/api/v1/routes/return'))
    await page.getByRole('button', { name: /Abort/i }).click()
    const body = (await request).postDataJSON()
    expect(Math.hypot(body.position.longitude - start.longitude, body.position.latitude - start.latitude)).toBeGreaterThan(0.00001)
    await page.screenshot({ path: 'test-results/freewalk-touch.png' })

    await page.getByRole('button', { name: 'App settings' }).click()
    await page.getByRole('radio', { name: 'right' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    const moved = (await joystick.boundingBox())!
    expect(moved.x + moved.width / 2).toBeGreaterThan(180)
  })
})
