import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('Cloudflare Free loads the planner and calculates all operations in a browser worker', async ({ page, request }) => {
  test.setTimeout(120_000)
  const bootstrap = await (await request.get('/api/v1/bootstrap')).json()
  test.skip(bootstrap.routing?.runtime !== 'browser', 'Only applies to the Cloudflare browser-routing deployment')
  const references = JSON.parse(readFileSync(new URL('../../../data/processed/cloudflare/references.json', import.meta.url), 'utf8'))
  const errors: string[] = [], serverRouting: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/api/v1/')) serverRouting.push(req.url()) })
  await page.goto('/')
  await expect(page.getByTestId('route-status')).toContainText('Route is safe to return', { timeout: 90_000 })
  await expect(page.getByTestId('route-action')).toHaveText('Route up to date')
  await expect(page.locator('.mars-map')).toBeVisible()
  const worker = page.workers().find((candidate) => candidate.url().includes('routing.worker'))
  expect(worker).toBeDefined()
  const result = await page.evaluate(async ({ workerUrl, config, mission }) => {
    const calculator = new Worker(workerUrl, { type: 'module' })
    let nextId = 0
    const call = (operation: string, body: unknown) => new Promise<any>((resolve, reject) => {
      const id = ++nextId
      calculator.onmessage = ({ data }) => { if (data.id === id) data.error ? reject(new Error(data.error)) : resolve(data.result) }
      calculator.onerror = () => reject(new Error('Browser routing worker failed'))
      calculator.postMessage({ id, config, operation, body })
    })
    try {
      const plan = await call('plan', mission)
      const point = { longitude: 77.439073689, latitude: 18.464058093 }
      const validation = await call('validate', point)
      const emergency = await call('return', { mission, position: point, remaining_energy: 30000 })
      const loss = await call('energy-loss', { mission, loss_pct: 80 })
      const invalid = await call('validate', { longitude: 0, latitude: 0 })
      return { plan, validation, emergency, loss, invalid }
    } finally { calculator.terminate() }
  }, { workerUrl: worker!.url(), config: bootstrap.routing, mission: bootstrap.default_mission })
  expect(result.plan.primary.metrics).toEqual(references.default.plan.primary.metrics)
  expect(result.plan.alternative.metrics).toEqual(references.default.plan.alternative.metrics)
  expect(result.validation).toEqual(references.validation)
  expect(result.emergency.route.metrics).toEqual(references.return.metrics)
  expect(result.loss.status).toBe('return_required')
  expect(result.invalid.valid).toBe(false)
  expect(serverRouting).toEqual([])
  expect(errors).toEqual([])
})
