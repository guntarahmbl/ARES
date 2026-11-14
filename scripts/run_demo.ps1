param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$raster = Join-Path $repoRoot "data\processed\rasters\routing_elevation_5m.tif"
$scene = Join-Path $repoRoot "data\processed\3d\scene.json"
$appIndex = Join-Path $repoRoot "app\dist\index.html"

if (-not (Test-Path -LiteralPath $raster)) {
    throw "Routing data is missing. Run fetch.py and preprocess.py as documented in data/README.md."
}

if (-not (Test-Path -LiteralPath $scene)) {
    Write-Host "Building local map and MarsWalk assets..." -ForegroundColor Cyan
    & python (Join-Path $repoRoot "scripts\web\build_assets.py")
    if ($LASTEXITCODE -ne 0) { throw "Asset build failed." }
}

if (-not (Test-Path -LiteralPath $appIndex)) {
    Write-Host "Building the ARES Path interface..." -ForegroundColor Cyan
    Push-Location (Join-Path $repoRoot "app")
    try {
        if (-not (Test-Path -LiteralPath "node_modules")) { & npm install }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
    }
    finally { Pop-Location }
}

$healthUrl = "http://127.0.0.1:8000/api/v1/health"
$serverRunning = $false
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    $serverRunning = $health.status -eq "ok"
}
catch { $serverRunning = $false }

if (-not $serverRunning) {
    Write-Host "Starting offline mission server..." -ForegroundColor Cyan
    Start-Process -FilePath "python" -ArgumentList @("-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory $repoRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            if ($health.status -eq "ok") { $serverRunning = $true; break }
        }
        catch { }
    }
}

if (-not $serverRunning) { throw "ARES Path server did not become ready." }

Write-Host "ARES Path is ready at http://127.0.0.1:8000" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:8000" }

