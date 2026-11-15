import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { deploy } from '../scripts/deploy_dokploy.mjs'

const revision = 'a'.repeat(40)
const json = data => Response.json({ result: { data: { json: data } } })

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ares-deploy-'))
  t.after(() => rmSync(directory, { recursive: true }))
  const archive = path.join(directory, 'release.zip')
  writeFileSync(archive, 'test archive')
  return { url: 'https://dokploy.test', token: 'test-token', applicationId: 'app', revision, archive, site: 'https://ares.test', ...overrides }
}

test('waits for the new deployment and correct public release, ignoring old health', async t => {
  let uploaded = false, polls = 0, healthChecks = 0
  const fetchRequest = async (url, options) => {
    if (url.startsWith('https://ares.test')) {
      healthChecks++
      return Response.json({ status: 'ok', release: healthChecks === 1 ? 'old' : revision, web_assets: true, marswalk_assets: true })
    }
    assert.equal(options.headers['x-api-key'], 'test-token')
    if (url.includes('dropDeployment')) {
      assert.equal(options.method, 'POST')
      assert.equal(options.body.get('applicationId'), 'app')
      assert.equal(options.body.get('zip').name, 'ares-vm.zip')
      uploaded = true
      return json(true)
    }
    assert.deepEqual(JSON.parse(new URL(url).searchParams.get('input')), { json: { applicationId: 'app' } })
    return json(uploaded ? [{ deploymentId: 'new', status: ++polls === 1 ? 'running' : 'done' }] : [{ deploymentId: 'old', status: 'done' }])
  }
  await deploy(fixture(t), fetchRequest, async () => {})
  assert.equal(healthChecks, 2)
})

test('fails on a build error even while the previous release remains healthy', async t => {
  let uploaded = false
  const fetchRequest = async url => {
    assert.ok(!url.startsWith('https://ares.test'), 'old public health cannot hide a failed build')
    if (url.includes('dropDeployment')) { uploaded = true; return json(true) }
    return json(uploaded ? [{ deploymentId: 'failed', status: 'error' }] : [])
  }
  await assert.rejects(deploy(fixture(t), fetchRequest, async () => {}), /deployment failed error/)
})

test('does not retry an upload rejected by Dokploy', async t => {
  let uploads = 0
  const fetchRequest = async url => {
    if (url.includes('dropDeployment')) { uploads++; return new Response('', { status: 403 }) }
    return json([])
  }
  await assert.rejects(deploy(fixture(t), fetchRequest), /HTTP 403/)
  assert.equal(uploads, 1)
})

test('fails when build succeeds but the expected release never becomes live', async t => {
  let uploaded = false
  const fetchRequest = async url => {
    if (url.includes('dropDeployment')) { uploaded = true; return json(true) }
    if (url.startsWith('https://ares.test')) return Response.json({ status: 'ok', release: 'old', web_assets: true, marswalk_assets: true })
    return json(uploaded ? [{ deploymentId: 'new', status: 'done' }] : [])
  }
  await assert.rejects(deploy(fixture(t, { timeoutMs: 25 }), fetchRequest, () => setTimeout(30)), /Timed out waiting for healthy release/)
})
