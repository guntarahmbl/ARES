# Dokploy VM deployment

Production: https://ares.disra.net, service **ares** in **dicky / production**.
Application ID: `ibY-Pc3Jp5qV-QcigRPBv`. The service listens on port **8000**
and runs one Uvicorn process with a 768 MiB memory limit.

The VM runs the React build, Python routing engine, and Mission Analyst.
9Router uses `https://9r.disra.net/v1` with model `cx/gpt-6-luna`.
Set `ARES_LLM_ENABLED=true`, `NINEROUTER_BASE_URL`, `NINEROUTER_MODEL`,
and `NINEROUTER_API_KEY` in Dokploy's environment settings. Keep the key out
of the source archive, image, and frontend build.

## Prepare a release

Prepare the scientific data as described in `data/README.md`, including
`python scripts/web/build_assets.py`, then build and package from the repo root:

```bash
npm --prefix app ci
npm --prefix app run build
python scripts/package_vm.py
```

`dist/ares-vm.zip` contains the Dockerfile, prepared frontend, backend, metadata,
thumbnails, map/3D assets, and seven runtime rasters. It excludes raw data,
intermediates, virtual environments, node_modules, and secrets. The Dockerfile
uses prebuilt frontend assets so the VM does not need Node.js or a frontend build.

Upload this ZIP using the application's **Drop** source in Dokploy. The generated
CLI 0.30.6 `application drop-deployment` command cannot supply its required
multipart ZIP; the initial deployment used the same CLI authentication with the
`application.dropDeployment` multipart API. Uploading starts a deployment.

To rebuild/redeploy the last uploaded release without changing its files:

```bash
dokploy application redeploy --applicationId ibY-Pc3Jp5qV-QcigRPBv
```

Inspect deployment status and logs in Dokploy. CLI 0.30.6 has an additional
compatibility issue for GET calls with parameters: its tRPC input needs a
`{"json": {...}}` envelope, which the generated GET commands omit.

## Data and domains

Runtime data is bundled in the image and read locally by Python. Existing R2
objects remain available to the separate Cloudflare Worker at
https://ares-path.mdikiisra98.workers.dev; this VM release does not read R2 directly.
Regenerate/repackage the ZIP to update scientific data.

`ares.disra.net` points to the Dokploy VM. Its former Worker custom domain is
removed from `cloudflare/wrangler.jsonc` so future Worker deployments do not
claim production again. GitHub Actions still validates code and publishes the
separate Worker; VM releases currently use the ZIP workflow above.

Check the deployment after each release:

```bash
curl --fail https://ares.disra.net/api/v1/health
curl --fail https://ares.disra.net/api/v1/assistant/status
```

The first endpoint should report the routing grid and both asset flags. The
second should report `available: true` and `state: ready`. Also calculate a
mission and send an Analyst query to validate actual computation and inference.
