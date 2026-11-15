# Dokploy VM deployment

Production: https://ares.disra.net, service **ares** in **dicky / production**.
Application ID: `ibY-Pc3Jp5qV-QcigRPBv`. The service listens on port **8000**
and runs one Uvicorn process with a 768 MiB memory limit.

The VM runs the React build, Python routing engine, and Mission Analyst.
9Router uses `https://9r.disra.net/v1` with model `cx/gpt-6-luna`.
Set `ARES_LLM_ENABLED=true`, `NINEROUTER_BASE_URL`, `NINEROUTER_MODEL`,
and `NINEROUTER_API_KEY` in Dokploy's environment settings. Keep the key out
of the source archive, image, and frontend build.

## Automatic releases

Every push to `main` runs `.github/workflows/ci.yml`: Python/frontend/Worker tests,
frontend build, restore the private R2 dataset, tests with production rasters,
ZIP upload to Dokploy, and verification of the exact commit on the public health
endpoint. A final smoke test calculates both routes and checks Analyst availability.
Pull requests and other branches run validation only. **Run workflow** on `main`
can also trigger a release manually. Deployments are serialized and are not
cancelled while a newer push waits.

GitHub repository configuration:

- Secret `DOKPLOY_API_TOKEN`: dedicated **ARES GitHub Actions VM deploy** key,
  expires November 15, 2027. Rotate it in Dokploy and GitHub before expiration.
- Variables `DOKPLOY_URL` and `DOKPLOY_APPLICATION_ID`: target instance and service.
- Existing secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: private R2
  download access. The Cloudflare token also expires November 15, 2027.

CI does not copy the Analyst key from Dokploy or change its environment. It fails
on a failed build, a dataset checksum mismatch, or a rollout that does not serve
the expected commit. A failed rollout requires inspection in Dokploy; this
pipeline does not automatically roll back.

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

Runtime data is bundled in the image and read locally by Python. CI downloads
the generated raster/map/3D dataset from the private R2 object pinned by
`deploy/dataset.json` and verifies its SHA-256 before extraction. Repository
metadata, science targets, and thumbnails come from the current Git commit.
The running VM does not need Cloudflare credentials or R2 access.

To update scientific data, regenerate it, run `python scripts/package_vm.py
--data-only`, calculate `sha256sum dist/ares-vm-data.zip`, and upload the ZIP to a
new key under `runtime/` in the private `ares-path-data` bucket. Update the key
and checksum in `deploy/dataset.json` in the same commit. Keep previous objects
for reproducing older releases; do not overwrite a checksum-pinned object.

The separate Cloudflare Worker and its existing dataset remain available at
https://ares-path.mdikiisra98.workers.dev. Publish it manually with Wrangler
if needed; the production workflow now deploys the VM only.

`ares.disra.net` points to the Dokploy VM. Its former Worker custom domain is
removed from `cloudflare/wrangler.jsonc` so future Worker deployments do not
claim production again.

Check the deployment after each release:

```bash
curl --fail https://ares.disra.net/api/v1/health
curl --fail https://ares.disra.net/api/v1/assistant/status
```

The first endpoint should report the release commit, routing grid and both asset flags. The
second should report `available: true` and `state: ready`. Also calculate a
mission and send an Analyst query to validate actual computation and inference.
