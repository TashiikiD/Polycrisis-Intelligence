param(
    [string]$EnvFile = ".env.local",
    [switch]$NoRemoteVerify
)

$ErrorActionPreference = "Stop"

$apiRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $apiRoot $EnvFile

if (-not (Test-Path $envPath)) {
    Write-Host "Missing $envPath" -ForegroundColor Red
    Write-Host "Create it from .env.local.example and paste your Stripe values." -ForegroundColor Yellow
    exit 1
}

$loaded = 0
Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
    $loaded += 1
}

Write-Host "Loaded $loaded env vars from $envPath (values hidden)." -ForegroundColor Green

Push-Location $apiRoot
try {
    Write-Host "`nRunning local readiness check..." -ForegroundColor Cyan
    python scripts/stripe_readiness_check.py
    $localExit = $LASTEXITCODE
    if ($localExit -ne 0) {
        Write-Host "Local readiness check reported issues (continuing to remote verify for detail)." -ForegroundColor Yellow
    }

    if (-not $NoRemoteVerify) {
        Write-Host "`nRunning Stripe remote verify..." -ForegroundColor Cyan
        python scripts/stripe_remote_verify.py
        $remoteExit = $LASTEXITCODE
    } else {
        $remoteExit = 0
    }

    if ($localExit -eq 0 -and $remoteExit -eq 0) {
        Write-Host "`nStripe env + IDs look ready." -ForegroundColor Green
    } else {
        exit 1
    }
}
finally {
    Pop-Location
}
