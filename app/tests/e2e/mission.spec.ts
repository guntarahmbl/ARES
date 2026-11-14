import { expect, test } from '@playwright/test'

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
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.getByRole('button', { name: /Add stop on map/i }).click()
  const map = page.locator('.mars-map')
  const box = await map.boundingBox()
  if (!box) throw new Error('Map did not produce a bounding box')
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.52)
  await expect(page.getByRole('dialog')).toContainText('Add checkpoint')
  await expect(page.getByText(/This location is traversable|Choose another location/)).toBeVisible({ timeout: 10_000 })
})

test('MarsWalk loads terrain and returns to planner', async ({ page }) => {
  const errors = captureErrors(page)
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
  await page.getByRole('navigation', { name: 'Primary view selector' }).getByRole('button', { name: 'MarsWalk' }).click()
  await expect(page.locator('.marswalk-shell canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: /Guided Tour/i })).toBeVisible()
  await expect(page.locator('.terrain-loader')).toHaveCount(0, { timeout: 5_000 })
  await page.getByRole('button', { name: /Planner/i }).first().click()
  await expect(page.locator('.mars-map')).toBeVisible()
  expect(errors).toEqual([])
})

for (const viewport of [
  { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
  { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
]) {
  test(`planner stays usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 20_000 })
    const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }))
    expect(overflow.x).toBeLessThanOrEqual(0)
    expect(overflow.y).toBeLessThanOrEqual(0)
    await expect(page.locator('.mars-map')).toBeVisible()
    await page.screenshot({ path: `test-results/planner-${viewport.width}x${viewport.height}.png` })
  })
}
