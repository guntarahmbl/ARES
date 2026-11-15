import { expect, test } from '@playwright/test'
import type { Bootstrap, RoutePlan } from '../../src/types'

const captureErrors = (page: import('@playwright/test').Page) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test('planner exposes a focused map-first mission flow', async ({ page }) => {
  const errors = captureErrors(page)
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await expect(page.getByTestId('route-action')).toHaveText('Route up to date')
  await expect(page.getByTestId('route-action')).toBeDisabled()
  await expect(page.locator('.mars-map')).toBeVisible()
  await expect(page.getByText('Plan an EVA')).toBeVisible()
  await page.getByRole('button', { name: 'Map layers' }).click()
  await expect(page.getByText('Map layers', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByRole('dialog')).toContainText('Why this route')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('custom checkpoint placement validates terrain before save', async ({ page }) => {
  const errors = captureErrors(page)
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.getByRole('button', { name: /Add stop on map/i }).click()
  const map = page.locator('.mars-map')
  const box = await map.boundingBox()
  if (!box) throw new Error('Map did not produce a bounding box')
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.52)
  await expect(page.getByRole('dialog')).toContainText('Add checkpoint')
  await expect(page.getByText(/This location is traversable|Choose another location/)).toBeVisible({ timeout: 10_000 })
  expect(errors).toEqual([])
})

test('changing a route constraint recalculates and returns to a synchronized state', async ({ page }) => {
  const errors = captureErrors(page)
  await page.goto('/')
  await expect(page.getByTestId('route-action')).toHaveText('Route up to date', { timeout: 20_000 })

  await page.getByText('Route settings', { exact: true }).click()
  const energy = page.locator('label', { hasText: 'Energy budget' }).locator('input[type="range"]')
  const recalculated = page.waitForResponse((response) => response.url().endsWith('/api/v1/routes/plan') && response.request().method() === 'POST')
  await energy.focus()
  await page.keyboard.press('ArrowLeft')
  await recalculated

  await expect(page.getByTestId('route-action')).toHaveText('Route up to date', { timeout: 20_000 })
  await expect(page.getByTestId('route-action')).toBeDisabled()
  expect(errors).toEqual([])
})

test('MarsWalk loads terrain and returns to planner', async ({ page }) => {
  const errors = captureErrors(page)
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
  await expect(page.locator('.marswalk-shell canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Route advisor' })).toBeVisible()
  await expect(page.getByLabel('Astronaut tracking map')).toBeVisible()
  await expect(page.getByRole('button', { name: /Guided Tour/i })).toBeVisible()
  await expect(page.locator('.terrain-loader')).toHaveCount(0, { timeout: 5_000 })
  await page.getByRole('button', { name: 'Collapse tracking map' }).click()
  await expect(page.getByRole('button', { name: 'Open tracking map' })).toBeVisible()
  await page.getByRole('button', { name: /Planner/i }).first().click()
  await expect(page.locator('.mars-map')).toBeVisible()
  await expect.poll(() => page.locator('canvas').count()).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('MarsWalk full map opens from minimap and M, pauses the tour, and returns to the walk', async ({ page }) => {
  const errors = captureErrors(page)
  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.keyboard.press('m')
  await expect(page.getByRole('dialog', { name: 'Mission map' })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
  await expect(page.locator('.terrain-loader')).toHaveCount(0, { timeout: 20_000 })
  await page.getByRole('button', { name: 'Zoom tracking map in', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Mission map' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const timeline = page.locator('.marswalk-shell input[aria-label="Route timeline scrub"]')
  await timeline.focus()
  await page.keyboard.press('m')
  const dialog = page.getByRole('dialog', { name: 'Mission map' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.mars-map canvas').first()).toBeVisible()
  const pausedProgress = await timeline.inputValue()
  await page.waitForTimeout(350)
  expect(await timeline.inputValue()).toBe(pausedProgress)
  await dialog.getByRole('button', { name: 'Show full area' }).click()
  await dialog.getByRole('button', { name: 'Locate astronaut' }).click()
  await page.keyboard.press('m')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  expect(await timeline.inputValue()).toBe(pausedProgress)

  await page.getByRole('button', { name: 'Open full map', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open full map', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Collapse tracking map' }).click()
  await page.keyboard.press('m')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close full map' }).click()
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press('m')
  await dialog.getByRole('button', { name: 'Open Planner', exact: true }).click()
  await expect(page.locator('.marswalk-shell')).toHaveCount(0)
  await expect(page.locator('.mars-map')).toBeVisible()
  expect(errors).toEqual([])
})

test('waypoint arrival opens once, reopens manually, and triggers at the second stop', async ({ page }) => {
  const errors = captureErrors(page)
  const bootstrap: Bootstrap = await (await page.request.get('/api/v1/bootstrap')).json()
  const plan: RoutePlan = await (await page.request.post('/api/v1/routes/plan', { data: bootstrap.default_mission })).json()
  const route = plan.primary!
  const distances = [0]
  for (let i = 1; i < route.scene_coordinates.length; i++) {
    const a = route.scene_coordinates[i - 1], b = route.scene_coordinates[i]
    distances.push(distances[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]))
  }
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
  await expect(page.locator('.terrain-loader')).toHaveCount(0, { timeout: 20_000 })

  for (const visit of route.stop_visits.slice(0, 2)) {
    const progress = distances[visit.route_vertex_index] / distances.at(-1)!
    await page.getByRole('slider', { name: 'Route timeline scrub' }).evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(element, String(value))
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, progress)
    const name = bootstrap.waypoints.features.find((feature) => feature.properties.id === visit.id)!.properties.name
    await expect(page.locator('aside').getByRole('heading', { name, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close target details' }).click()
    // Several telemetry updates while stationary must not reopen a dismissed popup.
    await page.waitForTimeout(1000)
    await expect(page.getByRole('button', { name: 'Close target details' })).toHaveCount(0)
    await page.getByRole('button', { name: 'View nearby waypoint details' }).click()
    await expect(page.locator('aside').getByRole('heading', { name, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close target details' }).click()
  }
  expect(errors).toEqual([])
})

test('free-walk emergency return uses the tracked astronaut coordinate', async ({ page }) => {
  const errors = captureErrors(page)
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  const bootstrap = await page.evaluate(async () => fetch('/api/v1/bootstrap').then((response) => response.json()))
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
  await expect(page.locator('.terrain-loader')).toHaveCount(0, { timeout: 5_000 })
  await page.getByRole('button', { name: /Guided Tour/i }).click()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/api/v1/routes/return'))
  await page.getByRole('button', { name: /Abort/i }).click()
  const request = await requestPromise
  const body = request.postDataJSON()
  expect(Math.abs(body.position.longitude - bootstrap.default_mission.habitat.longitude)).toBeGreaterThan(0.00001)
  expect(Math.abs(body.position.latitude - bootstrap.default_mission.habitat.latitude)).toBeGreaterThan(0.00001)
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'Planner' }).click()
  await expect(page.locator('.mars-map')).toBeVisible()
  await page.waitForTimeout(550)
  await page.screenshot({ path: 'test-results/planner-with-astronaut-position.png' })
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
  const restoredRequest = page.waitForRequest((candidate) => candidate.url().endsWith('/api/v1/routes/return'))
  await page.getByRole('button', { name: /Abort/i }).click()
  const restoredBody = (await restoredRequest).postDataJSON()
  expect(restoredBody.position.longitude).toBeCloseTo(body.position.longitude, 5)
  expect(restoredBody.position.latitude).toBeCloseTo(body.position.latitude, 5)
  expect(errors).toEqual([])
})

for (const viewport of [{ width: 360, height: 800 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test(`MarsWalk tracking map fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = captureErrors(page)
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
    await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
    const minimap = page.getByLabel('Astronaut tracking map')
    await expect(minimap).toBeVisible()
    const bounds = await minimap.boundingBox()
    if (!bounds) throw new Error('Tracking map did not produce a bounding box')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.waitForTimeout(550)
    await page.screenshot({ path: `test-results/marswalk-${viewport.width}x${viewport.height}.png` })
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
  { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
]) {
  test(`planner stays usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = captureErrors(page)
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
    const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }))
    expect(overflow.x).toBeLessThanOrEqual(0)
    expect(overflow.y).toBeLessThanOrEqual(0)
    await expect(page.locator('.mars-map')).toBeVisible()
    await page.screenshot({ path: `test-results/planner-${viewport.width}x${viewport.height}.png` })
    expect(errors).toEqual([])
  })
}

test('mission analyst answers from evidence and applies a validated proposal', async ({ page }) => {
  const errors = captureErrors(page)
  let asked: { message: string; mission: { route_stops: { id: string }[] } } | null = null
  await page.route('**/api/v1/assistant/status', (route) => route.fulfill({ json: { available: true, state: 'ready', provider: '9Router', model: 'test-model', detail: null } }))
  await page.route('**/api/v1/assistant/query', async (route) => {
    asked = route.request().postDataJSON()
    const mission = { ...asked!.mission, route_stops: asked!.mission.route_stops.slice(0, 2) }
    await route.fulfill({
      json: {
        request_id: 'request-1', intent: 'configure_mission', answer: 'Dropping the far stop saves the most [D-02].',
        citations: [{ dataset_id: 'D-02', title: 'HiRISE DTM', product_id: 'DTM', catalog_url: 'https://example.test/dtm', version: '1', resolution_m: 1, classification: 'measured', attribution: 'NASA', license: 'Public domain', processing: 'Derived 5 m routing grid' }],
        evidence: [], warnings: [], model: 'test-model', prompt_version: 'ares-analyst-v1',
        proposal: {
          summary: 'Skip Upper Delta Traverse.', changes: ['Stops changed'], mission, based_on_revision: 'revision-1',
          preview: { feasible: true, warnings: [], route: { distance_m: 6800, duration_min: 203, energy_units: 7538, return_reserve_units: 37462, maximum_slope_deg: 9, elevation_gain_m: 80, science_score: 54.5 } },
        },
      },
    })
  })
  await page.route('**/api/v1/assistant/proposals/apply', async (route) => {
    const payload = route.request().postDataJSON()
    const planned = await page.request.post('/api/v1/routes/plan', { data: payload.proposed_mission })
    await route.fulfill({ json: { mission: payload.proposed_mission, plan: await planned.json(), mission_revision: 'revision-2' } })
  })

  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Route advisor' }).click()
  const advisor = page.getByRole('complementary', { name: 'Route advisor' })
  await expect(advisor).toContainText('9Router · test-model')
  await advisor.getByLabel('Message to the route advisor').fill('Make it shorter')
  await page.keyboard.press('Enter')
  await expect(advisor).toContainText('Dropping the far stop saves the most')
  await expect(advisor).toContainText('was 13.5 km')
  expect(asked!.message).toBe('Make it shorter')

  await advisor.getByRole('button', { name: 'Apply to plan' }).click()
  await expect(advisor).toContainText('Applied to plan')
  await expect(page.getByTestId('route-action')).toHaveText('Route up to date', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Remove Upper Delta Traverse' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('advisor stays out of the way when the deployment has none', async ({ page }) => {
  await page.route('**/api/v1/assistant/status', (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Route advisor' })).toHaveCount(0)
})
