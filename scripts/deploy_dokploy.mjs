import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'

// ZIP upload is multipart; the generated Dokploy CLI cannot express this call.
export async function deploy(config, fetchRequest = fetch, wait = setTimeout) {
  const { url, token, applicationId, revision, archive, site } = config
  if (!url || !token || !applicationId || !/^[a-f0-9]{40}$/.test(revision ?? '')) {
    throw new Error('Set DOKPLOY_URL, DOKPLOY_API_TOKEN, DOKPLOY_APPLICATION_ID and GITHUB_SHA')
  }
  async function rpc(endpoint, form) {
    const query = form ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: { applicationId } }))}`
    const response = await fetchRequest(`${url.replace(/\/$/, '')}/api/trpc/${endpoint}${query}`, {
      method: form ? 'POST' : 'GET', headers: { 'x-api-key': token }, body: form,
      signal: AbortSignal.timeout(form ? 120_000 : 30_000),
    })
    if (!response.ok) throw new Error(`Dokploy ${endpoint}: HTTP ${response.status}`)
    const payload = await response.json()
    if (payload.error) throw new Error(`Dokploy ${endpoint} rejected the request; inspect Dokploy logs`)
    return payload.result?.data?.json ?? payload
  }

  const previous = new Set((await rpc('deployment.all')).map(item => item.deploymentId))
  const body = new FormData()
  body.set('applicationId', applicationId)
  body.set('dropBuildPath', '/')
  body.set('zip', new Blob([fs.readFileSync(archive)], { type: 'application/zip' }), 'ares-vm.zip')
  await rpc('application.dropDeployment', body)
  console.log(`Uploaded release ${revision}; waiting for Dokploy and public health`)

  const deadline = Date.now() + (config.timeoutMs ?? 900_000)
  let deploymentId
  let lastState
  while (Date.now() < deadline) {
    const deployments = await rpc('deployment.all')
    deploymentId ??= deployments.find(item => !previous.has(item.deploymentId))?.deploymentId
    const deployment = deployments.find(item => item.deploymentId === deploymentId)
    if (deployment?.status !== lastState) {
      lastState = deployment?.status
      console.log(`Deployment ${deploymentId}: ${lastState}`)
    }
    if (deployment?.status === 'error' || deployment?.status === 'cancelled') {
      throw new Error(`Dokploy deployment ${deploymentId} ${deployment.status}; inspect its build logs`)
    }
    if (deployment?.status === 'done') {
      try {
        const response = await fetchRequest(`${site}/api/v1/health?release=${revision}`, {
          cache: 'no-store', signal: AbortSignal.timeout(20_000),
        })
        const health = response.ok ? await response.json() : null
        if (health?.status === 'ok' && health.release === revision && health.web_assets && health.marswalk_assets) {
          console.log(`Verified ${site}: release ${revision} is healthy`)
          return
        }
      } catch { /* The service can be temporarily unavailable during the rollout. */ }
    }
    await wait(10_000)
  }
  throw new Error(`Timed out waiting for healthy release ${revision}; inspect Dokploy deployment ${deploymentId ?? 'queue'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deploy({
    url: process.env.DOKPLOY_URL, token: process.env.DOKPLOY_API_TOKEN,
    applicationId: process.env.DOKPLOY_APPLICATION_ID, revision: process.env.GITHUB_SHA,
    archive: 'dist/ares-vm.zip', site: 'https://ares.disra.net',
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
