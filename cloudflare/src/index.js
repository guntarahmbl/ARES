const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const key = (env, path) => `${env.DATA_PREFIX}${path}`;
let metadataPromise;

async function metadata(env) {
  if (!metadataPromise) {
    metadataPromise = env.DATA.get(key(env, 'metadata.json')).then(async (object) => {
      if (!object) throw new Error('Routing metadata is not uploaded');
      return object.json();
    }).catch((error) => { metadataPromise = undefined; throw error; });
  }
  return metadataPromise;
}

async function asset(request, env, ctx) {
  const cache = caches.default, cacheKey = new Request(request.url);
  if (request.method === 'GET' && !request.headers.has('Range')) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  let path = new URL(request.url).pathname.slice(1);
  if (path.startsWith('assets/routing/')) {
    if (!['assets/routing/metadata.json', 'assets/routing/grid.bin.gz'].includes(path)) return json({ detail: 'Asset not found.' }, 404);
    path = path.slice('assets/routing/'.length);
  }
  const rangeRequested = request.headers.has('Range');
  const object = await env.DATA.get(key(env, path), rangeRequested ? { range: request.headers } : undefined);
  if (!object) return json({ detail: 'Asset not found.' }, 404);
  if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });
  const headers = new Headers({ 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' });
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('ETag', object.httpEtag);
  const range = rangeRequested ? object.range : null;
  headers.set('Content-Length', String(range ? range.length : object.size));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  const response = new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
  if (request.method === 'GET' && !range) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    try {
      if (/^\/assets\/(web|3d|thumbnails|routing)\//.test(path)) {
        if (!['GET', 'HEAD'].includes(request.method)) return json({ detail: 'Method not allowed.' }, 405);
        return await asset(request, env, ctx);
      }
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (path === '/api/v1/bootstrap' || path === '/api/v1/health') {
        if (request.method !== 'GET') return json({ detail: 'Method not allowed.' }, 405);
        const meta = await metadata(env), version = encodeURIComponent(env.DATA_PREFIX);
        return json(path.endsWith('/bootstrap') ? {
          ...meta.bootstrap,
          routing: { runtime: 'browser', metadata_url: `/assets/routing/metadata.json?v=${version}`, grid_url: `/assets/routing/grid.bin.gz?v=${version}` },
        } : { status: 'ok', grid: { width: meta.width, height: meta.height, resolution_m: meta.resolution_m }, web_assets: true, marswalk_assets: true, runtime: 'cloudflare-workers', routing_runtime: 'browser' });
      }
      if (['/api/v1/routes/plan', '/api/v1/waypoints/validate', '/api/v1/routes/return', '/api/v1/scenarios/energy-loss'].includes(path)) {
        return json({ detail: 'Routing runs in a browser Web Worker on this deployment. Use the application to calculate routes.' }, 409);
      }
      return json({ detail: 'API endpoint not found.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ detail: 'Mission data is temporarily unavailable.' }, 503);
    }
  },
};
